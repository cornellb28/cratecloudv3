import chokidar from 'chokidar'
import { basename, extname } from 'path'
import type { FSWatcher } from 'chokidar'

// ─── Types ───────────────────────────────────────────────

export type ChangeType = 'added' | 'moved' | 'renamed' | 'deleted'

export interface PendingChange {
  rootId: number
  changeType: ChangeType
  oldPath: string | null
  newPath: string | null
  trackId: number | null
}

// ─── State ───────────────────────────────────────────────

// One watcher per library root
const watchers = new Map<number, FSWatcher>()

// Track recently unlinked files for move detection
// If a file is unlinked and then added within 2 seconds
// at a different path — it was moved, not deleted

const recentlyUnlinked = new Map<string, {
  path: string
  rootId: number
  timestamp: number
}>()

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aiff', '.aif', '.m4a', '.ogg'])

function isAudio(filepath: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(filepath).toLowerCase())
}

// ─── Callbacks ───────────────────────────────────────────
// Set by index.ts so the watcher can call back into the
// main process without circular imports

type OnFileAdded = (filepath: string, rootId: number) => Promise<void>
type OnFileMoved = (oldPath: string, newPath: string, rootId: number) => Promise<void>
type OnFileDeleted = (filepath: string, rootId: number) => Promise<void>
type OnRootOffline = (rootId: number, rootPath: string) => void
type OnRootOnline = (rootId: number, rootPath: string) => void

let onFileAdded: OnFileAdded = async () => {}
let onFileMoved: OnFileMoved = async () => {}
let onFileDeleted: OnFileDeleted = async () => {}
let onRootOffline: OnRootOffline = () => {}
let onRootOnline: OnRootOnline  = () => {}

export function setWatcherCallbacks(callbacks: {
  onFileAdded: OnFileAdded
  onFileMoved: OnFileMoved
  onFileDeleted: OnFileDeleted
  onRootOffline: OnRootOffline
  onRootOnline: OnRootOnline
}): void {
  onFileAdded = callbacks.onFileAdded
  onFileMoved = callbacks.onFileMoved
  onFileDeleted = callbacks.onFileDeleted
  onRootOffline = callbacks.onRootOffline
  onRootOnline = callbacks.onRootOnline
}

// ─── Start watching a root ────────────────────────────────

export function startWatcher(rootId: number, rootPath: string): void {
  // Do not start a duplicate watcher — falling through here used to create
  // a second chokidar instance and overwrite the Map entry, leaking the
  // first one (never closed, kept its own fs handles open).
  if (watchers.has(rootId)) {
    console.log(`[watcher] already watching root ${rootId}: ${rootPath}`)
    return
  }

  console.log(`[watcher] starting watcher for root ${rootId}: ${rootPath}`)

  const watcher = chokidar.watch(rootPath, {
    // Do not fire events for files that already existed
    // when the watcher starts — only new changes
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    // Ignore hidden files and macOS AppleDouble files
    ignored: /(^|[/\\])\../,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 200
    }
  })

  // ── File added ──────────────────────────────────────────
  watcher.on('add', async (filepath) => {
    if (!isAudio(filepath)) return

    console.log(`[watcher] file added: ${filepath}`)

    // Check if this is the destination of a recent move
    const moveCandidate = findMoveCandidate(filepath)
    if (moveCandidate) {
      console.log(`[watcher] move detected: ${moveCandidate.path} → ${filepath}`)
      recentlyUnlinked.delete(moveCandidate.path)
      await onFileMoved(moveCandidate.path, filepath, rootId)
      return
    }

    // Genuine new file
    await onFileAdded(filepath, rootId)
  })

  // ── File deleted ────────────────────────────────────────

  watcher.on('unlink', async (filepath) => {
    if (!isAudio(filepath)) return

    console.log(`[watcher] file removed: ${filepath}`)

    // Store in recently unlinked — might be a move
    recentlyUnlinked.set(filepath, {
      path: filepath,
      rootId,
      timestamp: Date.now()
    })

    // Wait 2 seconds — if no matching add arrives, treat as deleted
    setTimeout(async () => {
      if (recentlyUnlinked.has(filepath)) {
        recentlyUnlinked.delete(filepath)
        console.log(`[watcher] file deleted: ${filepath}`)
        await onFileDeleted(filepath, rootId)
      }
    }, 2000)
  })

  // ── Root folder goes offline ────────────────────────────

  watcher.on('error', (error) => {
    console.error(`[watcher] error on root ${rootId}:`, error)
  })

  // Detect when the root itself disappears (drive unplugged)
  watcher.on('raw', (event, path) => {
    if (event === 'rename' && path === rootPath) {
      console.log(`[watcher] root may have gone offline: ${rootPath}`)
      onRootOffline(rootId, rootPath)
    }
  })

  // At the bottom of startWatcher(), add:
  void onRootOnline // referenced to satisfy TypeScript

  watchers.set(rootId, watcher)
}

// ─── Stop watching a root ─────────────────────────────────

export async function stopWatcher(rootId: number): Promise<void> {
  const watcher = watchers.get(rootId)
  if (!watcher) return

  console.log(`[watcher] stopping watcher for root ${rootId}`)
  await watcher.close()
  watchers.delete(rootId)
}

export async function stopAllWatchers(): Promise<void> {
  const ids = Array.from(watchers.keys())
  await Promise.all(ids.map((id) => stopWatcher(id)))
}

// ─── Move detection helper ────────────────────────────────
// Finds a recently unlinked file that matches the added file
// by filename — heuristic for detecting moves

function findMoveCandidate(newPath: string): {
  path: string
  rootId: number
} | null {
  const newName = basename(newPath)
  const now     = Date.now()

  for (const [path, entry] of recentlyUnlinked.entries()) {
    // Must have same filename
    if (basename(path) !== newName) continue

    // Must be within 2 seconds
    if (now - entry.timestamp > 2000) {
      recentlyUnlinked.delete(path)
      continue
    }

    return { path, rootId: entry.rootId }
  }

  return null
}
