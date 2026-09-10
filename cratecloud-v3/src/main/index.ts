import { app, shell, BrowserWindow, ipcMain, dialog, protocol, nativeImage } from 'electron'
import { join, extname, basename, dirname, relative } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { execSync } from 'child_process'
import { randomUUID, createHash } from 'crypto'
import { rename, stat, unlink, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { createReadStream, createWriteStream } from 'fs'
import { startWatcher, stopWatcher, stopAllWatchers, setWatcherCallbacks } from './libraryWatcher'
import {
  insertTrack,
  insertTracksBatch,
  getAllTracks,
  getTrackById,
  getTracksByIds,
  updateTrackMeta,
  markTrackMissing,
  getAllTags,
  getMostUsedTags,
  addRoot,
  removeRoot,
  applyTag,
  removeTag,
  getTrackTags,
  getTrackTagsForTracks,
  getTagTracks,
  checkCandidates,
  confirmPendingImport,
  getPendingImports,
  getAllCrates,
  insertCrate,
  addTrackToCrate,
  getCrateTracks,
  getAllBoards,
  getTracksByColumn,
  updateBoardId,
  getSetting,
  setSetting,
  getTracksByBoardId,
  findOrCreateTag,
  getUnanalyzedTracks,
  setTrackArtworkHash,
  getArtworkHashesInUse,
  getTracksWithLegacyArtwork,
  updateTrackFilepath,
  markTrackAnalyzed,
  insertPendingChange,
  getPendingChanges,
  acceptPendingChange,
  ignorePendingChange,
  getTrackByFilepath,
  getAllRoots,
  ensureFolderTree,
  ensureFolderForDirectory,
  folderEvents,
  getFolderTree,
  getFolderTrackCounts,
  getTracksByFolder,
  backfillTrackFolderIds,
  isPathUnder
} from './db'
import { analyzeFile, readTagsFast } from './sidecar'

// Raise file handle limit for large libraries
try {
  execSync('ulimit -n 4096')
} catch {
  /* ignore on Windows */
}

// console.log('DB path:', join(app.getPath('userData'), 'cratecloud', 'library.db'))

// ── Walk a folder and find all audio files ──────────────────────────────────────────────
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aiff', '.aif', '.m4a', '.ogg'])

// ── Import job state (in-memory only) ────────────────────────────────────────────────────
// TODO: persist import jobs (id, folderPath, filepaths, nextIndex) to a DB table so a
// cancelled/interrupted job can be resumed after an app restart. This was proposed and
// explicitly deferred — needs a schema change and separate approval. As-is, resume only
// works within the same running app session (job state lives in `jobs` below).
type ImportPhase = 'counting' | 'parsing' | 'done' | 'cancelled' | 'error'

interface ImportProgressPayload {
  jobId: string
  phase: ImportPhase
  scanned: number
  total: number
  found: number
  skipped: number
  currentFolder: string
  estimateSeconds?: number
}

interface ImportJob {
  type: 'import'
  id: string
  folderPath: string
  filepaths: string[]
  relativeDirs: string[] // every directory the Pass 1 walk visited, relative to folderPath
  folderIdByRelPath?: Map<string, number> // set once via ensureFolderTree, reused across resumes
  nextIndex: number
  scanned: number
  found: number
  skipped: number
  total: number
  cancelRequested: boolean
  status: ImportPhase
  batchThroughputs: number[] // files/sec, rolling window — used for the ETA
}

// ── Move job state (in-memory only) ──────────────────────────────────────
type MovePhase = 'running' | 'done' | 'cancelled' | 'error'

interface MoveFailure {
  trackId: number
  filepath: string
  error: string
}

interface MoveProgressPayload {
  jobId: string
  phase: MovePhase
  done: number
  total: number
  currentFile: string
  bytesCopied: number // current file only, cross-device copies only
  totalBytes: number // current file only, cross-device copies only; 0 for a rename
  crossDevice: boolean // true once any EXDEV fallback has occurred in this job
  failed: MoveFailure[]
}

interface MoveJob {
  type: 'move'
  id: string
  trackIds: number[]
  destAbsolutePath: string
  cancelRequested: boolean
  status: MovePhase
  doneCount: number
  currentFile: string
  bytesCopied: number
  totalBytes: number
  crossDevice: boolean
  failed: MoveFailure[]
  lastEmitAt: number
}

// ── Copy-into-folder job state (drag-and-drop from Finder) ───────────────
// Deliberately not a MoveJob: it copies arbitrary dropped paths that have no
// track row yet (never a rename, the source must survive), and finishes by
// calling into the same import path dialogs use — importSingleFile or
// runFolderImport — rather than updateTrackFilepath. The two share the
// streaming-copy primitive (streamCopyWithProgress) and the throttled-emit
// pattern, not the job shape itself.
type CopyPhase = 'running' | 'done' | 'cancelled' | 'error'

interface CopyFailure {
  sourcePath: string
  error: string
}

interface CopyProgressPayload {
  jobId: string
  phase: CopyPhase
  done: number
  total: number
  currentFile: string
  bytesCopied: number
  totalBytes: number
  failed: CopyFailure[]
  // True for a FolderView Finder-drop (move-in-place); false for the
  // EmptyView/Board drop paths that never call this job. Purely a label
  // switch for the renderer — the underlying job is identical either way.
  deleteSource: boolean
}

interface CopyJob {
  type: 'copy'
  id: string
  destAbsolutePath: string
  // Built once at the start of the run (stat/walk is async, so it can't be
  // known at job-creation time) — one entry per file to copy, expanded from
  // the dropped paths (a dropped directory expands to every file in its tree).
  plan: { source: string; dest: string }[]
  hadDirectory: boolean
  cancelRequested: boolean
  status: CopyPhase
  doneCount: number
  currentFile: string
  bytesCopied: number
  totalBytes: number
  failed: CopyFailure[]
  copiedFilePaths: string[] // successfully copied, non-directory-drop case only
  lastEmitAt: number
  // When true, each file is moved (rename, falling back to stream-copy +
  // verify + unlink on EXDEV) instead of copied — same control flow as
  // moveOneTrackFile, just not keyed by trackId since a dropped file has no
  // track row yet.
  deleteSource: boolean
}

// One registry for every background job type, discriminated by `type`.
type Job = ImportJob | MoveJob | CopyJob
const jobs = new Map<string, Job>()

const COUNT_PROGRESS_INTERVAL_MS = 250
const PARSE_PROGRESS_FILES = 50
const PARSE_PROGRESS_INTERVAL_MS = 250
const INSERT_BATCH_SIZE = 200
const THROUGHPUT_WINDOW = 10 // batches
const ESTIMATE_ELIGIBLE_RATIO = 0.1 // don't show an ETA before 10% scanned

function buildProgressPayload(
  job: ImportJob,
  phaseOverride?: ImportPhase,
  currentFolder = ''
): ImportProgressPayload {
  const payload: ImportProgressPayload = {
    jobId: job.id,
    phase: phaseOverride ?? job.status,
    scanned: job.scanned,
    total: job.total,
    found: job.found,
    skipped: job.skipped,
    currentFolder
  }

  // Rolling-window throughput, not average-since-start — the first files are
  // often slow due to cache warmup and would skew an early estimate.
  const ratio = job.total > 0 ? job.scanned / job.total : 0
  if (ratio >= ESTIMATE_ELIGIBLE_RATIO && job.batchThroughputs.length > 0) {
    const avgThroughput =
      job.batchThroughputs.reduce((a, b) => a + b, 0) / job.batchThroughputs.length
    const remaining = job.total - job.scanned
    if (avgThroughput > 0) {
      payload.estimateSeconds = Math.round(remaining / avgThroughput)
    }
  }

  return payload
}

// Pass 1 (count) — walk the tree collecting audio file paths only, no metadata
// reads. Same EMFILE-safe one-directory-at-a-time queue as before, but now
// reports progress as it goes instead of staying silent until fully walked.
async function scanFolderPaths(
  folderPath: string,
  job: ImportJob,
  emit: (p: ImportProgressPayload) => void
): Promise<{ files: string[]; dirs: string[] }> {
  const results: string[] = []
  // Every directory the walk visits, relative to folderPath ("" for the
  // root) — collected here for free since the walk already touches every
  // directory once; ensureFolderTree needs the full set, not just the ones
  // that turned out to contain audio.
  const dirs = new Set<string>()
  const queue: string[] = [folderPath]
  let lastEmit = Date.now()

  while (queue.length > 0) {
    if (job.cancelRequested) break
    const dir = queue.shift()!
    dirs.add(relative(folderPath, dir))
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          queue.push(fullPath)
        } else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          results.push(fullPath)
        }
      }
    } catch {
      // skip unreadable directories
    }

    const now = Date.now()
    if (now - lastEmit >= COUNT_PROGRESS_INTERVAL_MS) {
      lastEmit = now
      emit({
        jobId: job.id,
        phase: 'counting',
        scanned: 0,
        total: 0,
        found: results.length,
        skipped: 0,
        currentFolder: dir
      })
    }
  }

  return { files: results, dirs: [...dirs] }
}

// Recursively count all audio files in a folder's subtree
async function countAudioFiles(folderPath: string): Promise<number> {
  try {
    const entries = await readdir(folderPath, { withFileTypes: true })
    let count = 0
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue // skip hidden files/folders (e.g. macOS ._ AppleDouble files, .DS_Store)
      const fullPath = join(folderPath, entry.name)
      if (entry.isDirectory()) {
        count += await countAudioFiles(fullPath)
      } else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        count++
      }
    }
    return count
  } catch {
    return 0
  }
}

// ── Content-addressed artwork storage ───────────────────────────────────────
// Artwork is deduped by content hash and shared across every track that
// embeds the same cover (the common case — every track on an album) instead
// of one file per track. See migrateArtworkToContentAddressed for the
// one-time move of legacy per-track <trackId>.jpg files onto this scheme.
const artworkDir = join(app.getPath('userData'), 'cratecloud', 'artwork')
const ARTWORK_MIGRATION_SETTING_KEY = 'artwork_migration_v1'

function artworkFullPath(hash: string): string {
  return join(artworkDir, `${hash}.jpg`)
}

function artworkThumbPath(hash: string): string {
  return join(artworkDir, `${hash}_200.jpg`)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// nativeImage.resize() stretches to fit when both width and height are given,
// so a true 200x200 cover crop needs the smaller side resized to 200 first
// (preserving aspect ratio) and the result center-cropped.
function makeThumbnailJpeg(image: Electron.NativeImage): Buffer {
  const { width, height } = image.getSize()
  const scale = 200 / Math.min(width, height)
  const resized = image.resize({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    quality: 'good'
  })
  const { width: rw, height: rh } = resized.getSize()
  const cropped = resized.crop({
    x: Math.max(0, Math.floor((rw - 200) / 2)),
    y: Math.max(0, Math.floor((rh - 200) / 2)),
    width: Math.min(200, rw),
    height: Math.min(200, rh)
  })
  return cropped.toJPEG(80)
}

// Hashes the image bytes and writes <hash>.jpg + a <hash>_200.jpg thumbnail
// once; every subsequent track that embeds the same cover just reuses the
// existing files. Returns the hash to store on the track row, or null on
// failure — a bad/corrupt embedded image must never fail the track import.
async function storeArtwork(imageBytes: Buffer): Promise<string | null> {
  try {
    await mkdir(artworkDir, { recursive: true })
    const hash = createHash('sha1').update(imageBytes).digest('hex')
    const fullPath = artworkFullPath(hash)

    if (await fileExists(fullPath)) return hash // another track already stored this cover

    await writeFile(fullPath, imageBytes)

    try {
      const image = nativeImage.createFromBuffer(imageBytes)
      if (!image.isEmpty()) {
        await writeFile(artworkThumbPath(hash), makeThumbnailJpeg(image))
      }
    } catch (err) {
      // Full-size art is saved and usable — a missing thumbnail just means
      // the renderer's 'thumb' request resolves to null and falls back to
      // its placeholder.
      console.error('[artwork] thumbnail generation failed:', err)
    }

    return hash
  } catch (err) {
    console.error('[artwork] storeArtwork failed:', err)
    return null
  }
}

// Single main-side resolver — the renderer never constructs a <hash>.jpg /
// <hash>_200.jpg path itself, it only ever asks for a hash + size.
async function artworkPathFor(hash: string | null, size: 'full' | 'thumb'): Promise<string | null> {
  if (!hash) return null
  const path = size === 'thumb' ? artworkThumbPath(hash) : artworkFullPath(hash)
  return (await fileExists(path)) ? path : null
}

// One-time migration of legacy per-track artwork onto content-addressed
// storage. Runs once, after the schema migration, off the import/analysis
// paths — throttled with a short pause every 25 files so it never starves
// IPC handlers while walking a large library. Completion is recorded in
// app_settings so it never re-runs; a row whose legacy file is already gone
// by the time this runs is simply left with artwork_hash NULL for good.
async function migrateArtworkToContentAddressed(): Promise<void> {
  if (getSetting(ARTWORK_MIGRATION_SETTING_KEY) === 'done') return

  const rows = getTracksWithLegacyArtwork()
  let migrated = 0
  let duplicatesRemoved = 0
  let bytesReclaimed = 0
  let failed = 0

  for (const row of rows) {
    try {
      const legacyStat = await stat(row.artwork_path) // throws if the file is gone
      const bytes = await readFile(row.artwork_path)
      const hash = createHash('sha1').update(bytes).digest('hex')
      const fullPath = artworkFullPath(hash)

      if (await fileExists(fullPath)) {
        // Another track already claimed this hash — this legacy file is a duplicate.
        await unlink(row.artwork_path)
        duplicatesRemoved++
        bytesReclaimed += legacyStat.size
      } else {
        await mkdir(artworkDir, { recursive: true })
        await rename(row.artwork_path, fullPath)
      }

      if (!(await fileExists(artworkThumbPath(hash)))) {
        try {
          const image = nativeImage.createFromBuffer(bytes)
          if (!image.isEmpty()) {
            await writeFile(artworkThumbPath(hash), makeThumbnailJpeg(image))
          }
        } catch (err) {
          console.error('[artwork migration] thumbnail generation failed:', err)
        }
      }

      setTrackArtworkHash(row.id, hash)
      migrated++
    } catch (err) {
      failed++
      console.error(`[artwork migration] track ${row.id} failed:`, err)
    }

    if (migrated % 25 === 0) {
      await new Promise((r) => setTimeout(r, 15))
    }
  }

  setSetting(ARTWORK_MIGRATION_SETTING_KEY, 'done')
  console.log(
    `[artwork migration] done — ${migrated} migrated, ${duplicatesRemoved} duplicates removed, ` +
      `${(bytesReclaimed / 1024 / 1024).toFixed(2)} MB reclaimed, ${failed} failed`
  )
}

// Deletes any <hash>.jpg / <hash>_200.jpg under the artwork dir whose hash
// isn't referenced by any track. Never runs automatically — only exposed via
// IPC for a manual cleanup action.
// TODO: surface in Settings
async function sweepOrphanedArtwork(): Promise<{ removed: number; bytesReclaimed: number }> {
  const inUse = getArtworkHashesInUse()
  let removed = 0
  let bytesReclaimed = 0

  let entries: string[]
  try {
    entries = await readdir(artworkDir)
  } catch {
    return { removed: 0, bytesReclaimed: 0 }
  }

  for (const entry of entries) {
    const match = entry.match(/^([0-9a-f]{40})(?:_200)?\.jpg$/)
    if (!match || inUse.has(match[1])) continue

    const fullPath = join(artworkDir, entry)
    try {
      const s = await stat(fullPath)
      await unlink(fullPath)
      removed++
      bytesReclaimed += s.size
    } catch (err) {
      console.error(`[artwork sweep] failed to remove ${entry}:`, err)
    }
  }

  return { removed, bytesReclaimed }
}

// Build a consistent track data object from analysis result
function buildTrackData(
  filepath: string,
  result: AnalysisResult,
  folderId: number | null = null
): {
  filepath: string
  filename: string
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  year: string | null
  comment: string | null
  label: string | null
  remixer: string | null
  composer: string | null
  grouping: string | null
  bpm: number | null
  key_camelot: string | null
  key_full: string | null
  camelot: string | null
  duration_sec: number | null
  duration_str: string | null
  analyzed_at: string | null
  board_id: number
  folder_id: number | null
} {
  return {
    filepath,
    filename: basename(filepath),
    title: result.title,
    artist: result.artist,
    album: result.album,
    genre: result.genre,
    year: result.year,
    comment: result.comment,
    label: result.label,
    remixer: result.remixer,
    composer: result.composer,
    grouping: result.grouping,
    bpm: result.bpm,
    key_camelot: result.key_camelot,
    key_full: result.key_full,
    camelot: result.camelot,
    duration_sec: result.duration_sec,
    duration_str: result.duration_str,
    analyzed_at: result.analyzed ? new Date().toISOString() : null,
    board_id: 1,
    folder_id: folderId
  }
}

// Copies fromPath to toPath in 1MB chunks, reporting cumulative bytes
// copied as it goes — the EXDEV fallback's replacement for the old
// all-or-nothing copyFile(), which had no way to report progress on a
// large file mid-copy.
function streamCopyWithProgress(
  fromPath: string,
  toPath: string,
  onProgress: (bytesCopied: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = createReadStream(fromPath, { highWaterMark: 1024 * 1024 })
    const writeStream = createWriteStream(toPath)
    let bytesCopied = 0

    readStream.on('data', (chunk: string | Buffer) => {
      bytesCopied += chunk.length
      onProgress(bytesCopied)
    })
    readStream.on('error', (err) => {
      writeStream.destroy()
      reject(err)
    })
    writeStream.on('error', reject)
    writeStream.on('finish', resolve)
    readStream.pipe(writeStream)
  })
}

// Moves one track's file to job.destAbsolutePath and updates its DB row.
// Every failure mode is caught and recorded in job.failed — this function
// never throws, so one bad file can never abort the rest of the job.
async function moveOneTrackFile(job: MoveJob, trackId: number): Promise<void> {
  const track = getTrackById(trackId)
  if (!track) {
    job.failed.push({ trackId, filepath: '', error: 'Track not found in the library' })
    return
  }

  const fromPath = track.filepath
  job.currentFile = fromPath
  job.bytesCopied = 0
  job.totalBytes = 0

  const toPath = join(job.destAbsolutePath, basename(fromPath))

  try {
    // Never overwrite — a name collision fails this file, not the job.
    try {
      await stat(toPath)
      job.failed.push({ trackId, filepath: fromPath, error: 'Destination already exists' })
      return
    } catch {
      // Good — does not exist
    }

    // Set once a size mismatch or a stale-source unlink happens below, but
    // the DB row still gets updated — the file itself landed correctly.
    let unlinkError: string | null = null

    try {
      await rename(fromPath, toPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err

      // Cross-device move — stream-copy, verify by size, then remove the source.
      job.crossDevice = true
      const sourceSize = (await stat(fromPath)).size
      job.totalBytes = sourceSize

      // TODO: sweep orphaned partial copies on startup. If the app is
      // killed mid-copy, toPath is left behind (writes go straight to it,
      // no temp-file+rename), but the DB row is untouched — updateTrackFilepath
      // only runs after this succeeds — so the source is never lost, just a
      // stray partial file to clean up.
      await streamCopyWithProgress(fromPath, toPath, (bytesCopied) => {
        job.bytesCopied = bytesCopied
      })

      const copiedSize = (await stat(toPath)).size
      if (copiedSize !== sourceSize) {
        await unlink(toPath).catch(() => {})
        throw new Error(
          `Copy verification failed (${copiedSize} of ${sourceSize} bytes) — source left untouched`
        )
      }

      try {
        await unlink(fromPath)
      } catch (err) {
        // The copy is good — do not roll it back. The DB still gets pointed
        // at the new path below; the stale source just needs manual cleanup.
        unlinkError = (err as Error).message
      }
    }

    // The only point the DB changes — a crash before this leaves the row
    // pointing at the still-intact source.
    updateTrackFilepath(fromPath, toPath)

    if (unlinkError) {
      job.failed.push({
        trackId,
        filepath: fromPath,
        error: `Moved, but couldn't remove the original file: ${unlinkError}`
      })
    }
  } catch (err) {
    job.failed.push({ trackId, filepath: fromPath, error: (err as Error).message })
  }
}

function buildMoveProgressPayload(job: MoveJob, phaseOverride?: MovePhase): MoveProgressPayload {
  return {
    jobId: job.id,
    phase: phaseOverride ?? job.status,
    done: job.doneCount,
    total: job.trackIds.length,
    currentFile: job.currentFile,
    bytesCopied: job.bytesCopied,
    totalBytes: job.totalBytes,
    crossDevice: job.crossDevice,
    failed: job.failed
  }
}

const MOVE_PROGRESS_INTERVAL_MS = 250

// Throttled the same way import progress is: every 250ms or every file
// completion (force), never per-chunk — a big cross-device copy would
// otherwise emit on every 1MB stream chunk.
function maybeEmitMoveProgress(
  event: Electron.IpcMainInvokeEvent,
  job: MoveJob,
  force = false
): void {
  const now = Date.now()
  if (force || now - job.lastEmitAt >= MOVE_PROGRESS_INTERVAL_MS) {
    job.lastEmitAt = now
    event.sender.send('move:progress', buildMoveProgressPayload(job))
  }
}

// Sequential, one file at a time — the cancel flag is only checked between
// files (never mid-copy), and moveOneTrackFile never throws, so a bad file
// can't abort the ones after it. No resume for move jobs (unlike import):
// cancelling ends the job for good, matching Part B/C's scope.
async function runMoveJob(event: Electron.IpcMainInvokeEvent, job: MoveJob): Promise<void> {
  job.status = 'running'

  for (const trackId of job.trackIds) {
    if (job.cancelRequested) {
      job.status = 'cancelled'
      maybeEmitMoveProgress(event, job, true)
      jobs.delete(job.id)
      return
    }

    await moveOneTrackFile(job, trackId)
    job.doneCount++
    job.currentFile = ''
    job.bytesCopied = 0
    job.totalBytes = 0
    maybeEmitMoveProgress(event, job, true)
  }

  job.status = 'done'
  maybeEmitMoveProgress(event, job, true)
  jobs.delete(job.id)
}

// Every file under dirPath, recursively — no audio-extension filter (unlike
// scanFolderPaths): dropping a folder from Finder should copy the whole
// tree as-is, the same way Finder itself would, and let the re-scan that
// follows decide what's importable.
async function collectFilesRecursive(dirPath: string): Promise<string[]> {
  const results: string[] = []
  const queue: string[] = [dirPath]
  while (queue.length > 0) {
    const dir = queue.shift()!
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) queue.push(full)
        else results.push(full)
      }
    } catch {
      // skip unreadable directories
    }
  }
  return results
}

// Copies (or moves, when job.deleteSource is set) one file to an explicit
// destination (unlike moveOneTrackFile, the destination isn't derived from
// basename(source) here — a directory-tree copy/move needs the source's
// position relative to the dropped folder preserved). copy mode never
// touches the source — the DJ dropped this from Finder, their original
// stays put no matter what. move mode renames first, falling back to
// stream-copy + verify + unlink on EXDEV, same as moveOneTrackFile. Every
// failure mode is caught and recorded in job.failed; this never throws, so
// one bad file can't abort the rest of the run.
async function copyOneFileIntoFolder(
  job: CopyJob,
  sourcePath: string,
  destPath: string
): Promise<boolean> {
  job.currentFile = sourcePath
  job.bytesCopied = 0
  job.totalBytes = 0

  try {
    // Never overwrite — a name collision fails this file, not the job, and
    // (in move mode) leaves the source untouched.
    try {
      await stat(destPath)
      job.failed.push({ sourcePath, error: 'Destination already exists' })
      return false
    } catch {
      // Good — does not exist
    }

    if (!job.deleteSource) {
      const sourceSize = (await stat(sourcePath)).size
      job.totalBytes = sourceSize

      await streamCopyWithProgress(sourcePath, destPath, (bytesCopied) => {
        job.bytesCopied = bytesCopied
      })

      const copiedSize = (await stat(destPath)).size
      if (copiedSize !== sourceSize) {
        await unlink(destPath).catch(() => {})
        throw new Error(
          `Copy verification failed (${copiedSize} of ${sourceSize} bytes) — source left untouched`
        )
      }

      return true
    }

    // Move mode — rename first (instant, same-volume); EXDEV means the
    // destination is on a different volume, so fall back to stream-copy,
    // verify, then remove the source.
    try {
      await rename(sourcePath, destPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err

      const sourceSize = (await stat(sourcePath)).size
      job.totalBytes = sourceSize

      await streamCopyWithProgress(sourcePath, destPath, (bytesCopied) => {
        job.bytesCopied = bytesCopied
      })

      const copiedSize = (await stat(destPath)).size
      if (copiedSize !== sourceSize) {
        await unlink(destPath).catch(() => {})
        throw new Error(
          `Copy verification failed (${copiedSize} of ${sourceSize} bytes) — source left untouched`
        )
      }

      try {
        await unlink(sourcePath)
      } catch (err) {
        // The copy landed fine — do not roll it back. Record it as a
        // failure anyway so the DJ knows the original needs manual cleanup,
        // even though the file is safely at the destination.
        job.failed.push({
          sourcePath,
          error: `Moved, but couldn't remove the original file: ${(err as Error).message}`
        })
        return true
      }
    }

    return true
  } catch (err) {
    job.failed.push({ sourcePath, error: (err as Error).message })
    return false
  }
}

function buildCopyProgressPayload(job: CopyJob, phaseOverride?: CopyPhase): CopyProgressPayload {
  return {
    jobId: job.id,
    phase: phaseOverride ?? job.status,
    done: job.doneCount,
    total: job.plan.length,
    currentFile: job.currentFile,
    bytesCopied: job.bytesCopied,
    totalBytes: job.totalBytes,
    failed: job.failed,
    deleteSource: job.deleteSource
  }
}

const COPY_PROGRESS_INTERVAL_MS = 250

function maybeEmitCopyProgress(
  event: Electron.IpcMainInvokeEvent,
  job: CopyJob,
  force = false
): void {
  const now = Date.now()
  if (force || now - job.lastEmitAt >= COPY_PROGRESS_INTERVAL_MS) {
    job.lastEmitAt = now
    event.sender.send('copy:progress', buildCopyProgressPayload(job))
  }
}

// Update just the analysis fields after Phase 2 completes
function updateTrackAnalysis(trackId: number, result: AnalysisResult): void {
  const existing = getTrackById(trackId)
  updateTrackMeta({
    id: trackId,
    title: result.title,
    artist: result.artist,
    genre: result.genre,
    bpm: result.bpm,
    key_camelot: result.key_camelot,
    energy: null,
    comment: result.comment,
    artwork_path: existing?.artwork_path ?? null,
    needs_sync: 0,
    pending_changes: null
  })
}

async function runFolderImport(
  event: Electron.IpcMainInvokeEvent,
  folderPath: string,
  jobId?: string
): Promise<{
  imported: number
  failed: number
  total: number
  jobId: string
  cancelled?: boolean
}> {
  // Pause watcher for this root during import to avoid EMFILE
  const roots = getAllRoots()
  const matchingRoot = roots.find((r) => isPathUnder(folderPath, r.path))
  if (matchingRoot) {
    await stopWatcher(matchingRoot.id)
    // Create the root's own folder row immediately, not after Pass 1 — the
    // renderer's root picker resolves a root's card to a folder id via
    // folders:tree and stays unclickable (no crash, just a silent no-op)
    // until that row exists, which previously meant the whole counting
    // phase on a large library.
    ensureFolderTree(matchingRoot.id, [''])
  }

  const id = jobId ?? randomUUID()
  const existing = jobs.get(id)
  const job: ImportJob =
    existing && existing.type === 'import'
      ? existing
      : {
          type: 'import',
          id,
          folderPath,
          filepaths: [],
          relativeDirs: [],
          nextIndex: 0,
          scanned: 0,
          found: 0,
          skipped: 0,
          total: 0,
          cancelRequested: false,
          status: 'counting',
          batchThroughputs: []
        }
  jobs.set(id, job)

  const emit = (p: ImportProgressPayload): void => event.sender.send('import:progress', p)

  // Pass 1 (count) — skipped when resuming a job that already has its file list
  if (job.filepaths.length === 0) {
    job.status = 'counting'
    const scanned = await scanFolderPaths(folderPath, job, emit)

    if (job.cancelRequested) {
      // Discard the partial count — a future resume should redo pass 1 cleanly
      // rather than resume over an incomplete file list.
      job.filepaths = []
      job.status = 'cancelled'
      emit(buildProgressPayload(job, 'cancelled'))
      if (matchingRoot) startWatcher(matchingRoot.id, matchingRoot.path)
      return {
        imported: job.found,
        failed: job.skipped,
        total: job.total,
        jobId: id,
        cancelled: true
      }
    }

    job.filepaths = scanned.files
    // scanned.dirs are relative to folderPath, but ensureFolderTree needs
    // them relative to the registered ROOT — the same thing only when
    // folderPath is the root itself. Re-scanning a subfolder of an
    // already-registered root (folderPath !== matchingRoot.path, e.g. via
    // FolderView's "Re-scan this folder") would otherwise resolve every
    // file's "" relative dir to the root's own folder id instead of the
    // subfolder's.
    job.relativeDirs = matchingRoot
      ? scanned.dirs.map((d) => relative(matchingRoot.path, join(folderPath, d)))
      : scanned.dirs
    job.total = job.filepaths.length
  }

  if (job.total === 0) {
    job.status = 'done'
    emit(buildProgressPayload(job, 'done'))
    if (matchingRoot) startWatcher(matchingRoot.id, matchingRoot.path)
    jobs.delete(id)
    return { imported: 0, failed: 0, total: 0, jobId: id }
  }

  // Build the folder tree once per job (idempotent — safe to redo on resume)
  // and resolve each file's directory to a folder id from it. No matchingRoot
  // means this folder isn't a registered library root — folder_id stays null
  // for every track in that case, same as importSingleFile.
  if (!job.folderIdByRelPath && matchingRoot) {
    job.folderIdByRelPath = ensureFolderTree(matchingRoot.id, job.relativeDirs)
  }
  const resolveFolderId = (filepath: string): number | null => {
    if (!job.folderIdByRelPath || !matchingRoot) return null
    const relDir = relative(matchingRoot.path, dirname(filepath))
    return job.folderIdByRelPath.get(relDir) ?? null
  }

  // Pass 2 (parse) — fast tag read + insert, batched into ~200-row transactions
  job.status = 'parsing'
  const concurrency = 4
  let sinceEmit = 0
  let lastEmit = Date.now()
  let currentFolderLabel = ''

  // Checked after every concurrency chunk (every ~4 files), not just once per
  // 200-row batch — a batch can take many seconds on a real library, and the
  // spec's "every 50 files or 250ms" cadence would otherwise go unmet for the
  // whole batch.
  const maybeEmitParsingProgress = (force = false): void => {
    const now = Date.now()
    if (
      force ||
      sinceEmit >= PARSE_PROGRESS_FILES ||
      now - lastEmit >= PARSE_PROGRESS_INTERVAL_MS
    ) {
      lastEmit = now
      sinceEmit = 0
      emit(buildProgressPayload(job, 'parsing', currentFolderLabel))
    }
  }

  for (let i = job.nextIndex; i < job.filepaths.length; i += INSERT_BATCH_SIZE) {
    if (job.cancelRequested) {
      job.status = 'cancelled'
      job.nextIndex = i
      emit(
        buildProgressPayload(
          job,
          'cancelled',
          dirname(job.filepaths[Math.max(i - 1, 0)] ?? folderPath)
        )
      )
      if (matchingRoot) startWatcher(matchingRoot.id, matchingRoot.path)
      runPhase2Analysis(event) // analyze whatever made it in before the cancel
      return {
        imported: job.found,
        failed: job.skipped,
        total: job.total,
        jobId: id,
        cancelled: true
      }
    }

    const batchStart = Date.now()
    const batchPaths = job.filepaths.slice(i, i + INSERT_BATCH_SIZE)
    const parsedRows: { data: ReturnType<typeof buildTrackData>; artwork: string | null }[] = []

    for (let j = 0; j < batchPaths.length; j += concurrency) {
      const chunk = batchPaths.slice(j, j + concurrency)
      await Promise.all(
        chunk.map(async (filepath) => {
          try {
            const result = await readTagsFast(filepath)
            job.scanned++
            if (!result.success) {
              job.skipped++
              return
            }
            parsedRows.push({
              data: buildTrackData(filepath, result, resolveFolderId(filepath)),
              artwork: result.artwork_base64
            })
          } catch {
            job.scanned++
            job.skipped++
          }
        })
      )

      sinceEmit += chunk.length
      currentFolderLabel = dirname(chunk[chunk.length - 1])
      maybeEmitParsingProgress()
    }

    // One transaction per batch instead of one fsync-backed write per file
    if (parsedRows.length > 0) {
      const inserted = insertTracksBatch(parsedRows.map((r) => r.data))
      for (let idx = 0; idx < inserted.length; idx++) {
        const row = inserted[idx]
        job.found++
        const artwork = parsedRows[idx].artwork
        if (artwork && row.id > 0) {
          const hash = await storeArtwork(Buffer.from(artwork, 'base64'))
          if (hash) setTrackArtworkHash(row.id, hash)
        }
      }
    }

    job.nextIndex = i + batchPaths.length

    // Batch committed — renderer refetches on this, debounced on that side so
    // a burst of fast batches collapses into a single reload.
    event.sender.send('import:batch-committed', { jobId: id })

    const batchMs = Date.now() - batchStart
    if (batchMs > 0) {
      job.batchThroughputs.push((batchPaths.length / batchMs) * 1000)
      if (job.batchThroughputs.length > THROUGHPUT_WINDOW) job.batchThroughputs.shift()
    }

    // Force a progress emit right after the commit so `found` reflects the
    // batch that just landed, instead of waiting for the next chunk's throttle.
    maybeEmitParsingProgress(true)

    // Yield to the event loop after each committed batch so the main process
    // stays responsive to other IPC (folder browsing, playback, etc.) mid-import.
    await new Promise((resolve) => setImmediate(resolve))
  }

  job.status = 'done'
  emit(buildProgressPayload(job, 'done'))
  jobs.delete(id)

  // Restart watcher after import completes
  if (matchingRoot) startWatcher(matchingRoot.id, matchingRoot.path)

  runPhase2Analysis(event)

  return { imported: job.found, failed: job.skipped, total: job.total, jobId: id }
}

async function runPhase2Analysis(event: Electron.IpcMainInvokeEvent): Promise<void> {
  // Only analyze tracks that Phase 1 did not already resolve
  // (tracks that had BPM/key tags skip librosa entirely)
  const unanalyzed = getUnanalyzedTracks() as Track[]

  if (unanalyzed.length === 0) {
    event.sender.send('library:analysis-complete', {
      analyzed: 0,
      total: 0
    })
    return
  }

  const total = unanalyzed.length
  let done = 0
  const concurrency = 4 // librosa is heavy — keep this lower

  for (let i = 0; i < unanalyzed.length; i += concurrency) {
    const batch = unanalyzed.slice(i, i + concurrency)

    await Promise.all(
      batch.map(async (track) => {
        try {
          const result = await analyzeFile(track.filepath)

          if (result.success) {
            // Update just the analysis fields
            updateTrackMeta({
              id: track.id,
              title: track.title,
              artist: track.artist,
              genre: track.genre,
              bpm: result.bpm,
              key_camelot: result.key_camelot,
              energy: null,
              comment: track.comment,
              artwork_path: track.artwork_path,
              needs_sync: 0,
              pending_changes: null
            })

            // Mark as analyzed
            markTrackAnalyzed(track.id)

            done++

            // Tell renderer to update this track's badges
            event.sender.send('library:track-analyzed', {
              trackId: track.id,
              bpm: result.bpm,
              key_camelot: result.key_camelot,
              key_full: result.key_full,
              duration_sec: result.duration_sec,
              duration_str: result.duration_str,
              done,
              total
            })
          }
        } catch {
          // Skip failed analysis — track still visible without BPM
          done++
        }
      })
    )

    await new Promise((r) => setTimeout(r, 100))
  }

  event.sender.send('library:analysis-complete', {
    analyzed: done,
    total
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'artwork',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true
    }
  }
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  let artworkInFlight = 0
  const ARTWORK_CONCURRENCY = 8
  // ── Register a custom protocol for serving local artwork ──────────────────────────────────────────────
  protocol.handle('artwork', async (request) => {
    // Wait if too many concurrent requests
    while (artworkInFlight >= ARTWORK_CONCURRENCY) {
      await new Promise((r) => setTimeout(r, 50))
    }
    artworkInFlight++
    try {
      const artworkPath = decodeURIComponent(request.url.replace('artwork://', ''))
      const data = await readFile(artworkPath)
      return new Response(data, {
        headers: { 'Content-Type': 'image/jpeg' }
      })
    } catch {
      return new Response(null, { status: 404 })
    } finally {
      artworkInFlight--
    }
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Dialog Actions

  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
      title: 'Select your music folder'
    })

    if (result.canceled) return null
    console.log(result)
    return result.filePaths[0]
  })

  // ── Tracks ──────────────────────────────────────────────
  ipcMain.handle('library:import-folder', async (event, folderPath: string) => {
    try {
      // Register as root if not already nested — done BEFORE the import
      // (not after) so runFolderImport has a library_root row to resolve
      // folder_id against via ensureFolderTree.
      const existingRoots = getAllRoots()
      const alreadyNested = existingRoots.some((r) => isPathUnder(folderPath, r.path))
      if (!alreadyNested) {
        const rootResult = addRoot(basename(folderPath), folderPath)
        const rootId = Number(rootResult.lastInsertRowid)
        startWatcher(rootId, folderPath)
      }

      const result = await runFolderImport(event, folderPath)

      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('import:cancel', (_e, jobId: string) => {
    const job = jobs.get(jobId)
    if (!job || job.type !== 'import')
      return { ok: false, error: 'Unknown or already-finished job' }
    job.cancelRequested = true
    return { ok: true }
  })

  ipcMain.handle('import:resume', async (event, jobId: string) => {
    const job = jobs.get(jobId)
    if (!job || job.type !== 'import') {
      return {
        ok: false,
        error: 'Job not found — in-memory resume does not survive an app restart'
      }
    }
    job.cancelRequested = false
    try {
      const result = await runFolderImport(event, job.folderPath, jobId)
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  async function importSingleFile(
    event: Electron.IpcMainInvokeEvent,
    filepath: string
  ): Promise<{ ok: boolean; trackId?: number; error?: string }> {
    try {
      // Phase 1
      const fastResult = await readTagsFast(filepath)
      // TODO: optionally resolve against a registered root if the file lives under one
      const trackData = buildTrackData(filepath, fastResult)
      const insertResult = insertTrack(trackData) as { lastInsertRowid: number | bigint }
      const trackId = Number(insertResult.lastInsertRowid)

      if (fastResult.artwork_base64 && trackId > 0) {
        const hash = await storeArtwork(Buffer.from(fastResult.artwork_base64, 'base64'))
        if (hash) setTrackArtworkHash(trackId, hash)
      }

      // Tell renderer the track exists so it can refresh the list
      event.sender.send('library:import-progress', {
        done: 1,
        total: 1,
        failed: 0,
        filepath: basename(filepath)
      })

      // Phase 2 - analyze this one file immediately
      // Single file is fast enough to do inline
      const fullResult = await analyzeFile(filepath)

      if (fullResult.success) {
        updateTrackAnalysis(trackId, fullResult)

        event.sender.send('library:track-analyzed', {
          trackId,
          bpm: fullResult.bpm,
          key_camelot: fullResult.key_camelot,
          key_full: fullResult.key_full,
          duration_sec: fullResult.duration_sec,
          duration_str: fullResult.duration_str,
          done: 1,
          total: 1
        })
      }

      return { ok: true, trackId }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  ipcMain.handle('library:import-file', async (event, filepath: string) => {
    return importSingleFile(event, filepath)
  })

  // Drag-and-drop from Finder into a specific folder — copies every dropped
  // path into destAbsolutePath (never a rename: the DJ's source must
  // survive), then imports via the exact same handlers the dialogs use:
  // importSingleFile per copied file, or a re-scan of the destination
  // folder if any dropped item was a directory (so ensureFolderTree picks
  // up the new subtree). The 'done' progress event isn't emitted until
  // that import step finishes too, so the renderer's completion handler
  // can safely refetch tracks right then.
  async function runCopyIntoFolderJob(
    event: Electron.IpcMainInvokeEvent,
    job: CopyJob,
    sourcePaths: string[],
    currentFolderPath: string
  ): Promise<void> {
    job.status = 'running'

    // Build the plan — a dropped directory expands to every file in its
    // tree, preserving its structure under destAbsolutePath/<dirName>/...
    for (const sourcePath of sourcePaths) {
      let sourceStat
      try {
        sourceStat = await stat(sourcePath)
      } catch {
        job.failed.push({ sourcePath, error: 'Source no longer exists' })
        continue
      }
      if (sourceStat.isDirectory()) {
        job.hadDirectory = true
        const dirName = basename(sourcePath)
        const files = await collectFilesRecursive(sourcePath)
        for (const file of files) {
          job.plan.push({
            source: file,
            dest: join(job.destAbsolutePath, dirName, relative(sourcePath, file))
          })
        }
      } else {
        job.plan.push({
          source: sourcePath,
          dest: join(job.destAbsolutePath, basename(sourcePath))
        })
      }
    }

    maybeEmitCopyProgress(event, job, true) // total is known now

    for (const { source, dest } of job.plan) {
      if (job.cancelRequested) {
        job.status = 'cancelled'
        maybeEmitCopyProgress(event, job, true)
        jobs.delete(job.id)
        return
      }

      await mkdir(dirname(dest), { recursive: true })
      const ok = await copyOneFileIntoFolder(job, source, dest)
      if (ok) job.copiedFilePaths.push(dest)
      job.doneCount++
      job.currentFile = ''
      job.bytesCopied = 0
      job.totalBytes = 0
      maybeEmitCopyProgress(event, job, true)
    }

    // Copying is done — now import, via the same handlers the dialogs use.
    // Held until after this so the renderer's 'done' handler can safely
    // refetch tracks knowing the import actually finished too.
    if (job.hadDirectory) {
      await runFolderImport(event, currentFolderPath)
    } else {
      for (const path of job.copiedFilePaths) {
        await importSingleFile(event, path)
      }
    }

    job.status = 'done'
    maybeEmitCopyProgress(event, job, true)
    jobs.delete(job.id)
  }

  ipcMain.handle(
    'fs:copy-into-folder',
    (
      event,
      payload: {
        sourcePaths: string[]
        destAbsolutePath: string
        currentFolderPath: string
        deleteSource?: boolean
      }
    ) => {
      const job: CopyJob = {
        type: 'copy',
        id: randomUUID(),
        destAbsolutePath: payload.destAbsolutePath,
        plan: [],
        hadDirectory: false,
        cancelRequested: false,
        status: 'running',
        doneCount: 0,
        currentFile: '',
        bytesCopied: 0,
        totalBytes: 0,
        failed: [],
        copiedFilePaths: [],
        lastEmitAt: 0,
        deleteSource: payload.deleteSource ?? false
      }
      jobs.set(job.id, job)
      runCopyIntoFolderJob(event, job, payload.sourcePaths, payload.currentFolderPath) // fire-and-forget
      return { jobId: job.id }
    }
  )

  ipcMain.handle('fs:cancel-copy', (_e, jobId: string) => {
    const job = jobs.get(jobId)
    if (!job || job.type !== 'copy') {
      return { ok: false, error: 'Unknown or already-finished job' }
    }
    job.cancelRequested = true
    return { ok: true }
  })

  // ── Multi file import ────────────────────────────────────

  ipcMain.handle('library:import-files', async (event, filepaths: string[]) => {
    const results: Awaited<ReturnType<typeof importSingleFile>>[] = []
    for (const filepath of filepaths) {
      results.push(await importSingleFile(event, filepath))
    }
    return { ok: true, count: filepaths.length, results }
  })

  ipcMain.handle('dialog:open-files', async () => {
    if (!mainWindow) return []
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: 'Add tracks',
      filters: [
        {
          name: 'Audio',
          extensions: ['mp3', 'flac', 'wav', 'aiff', 'aif', 'm4a', 'ogg']
        }
      ]
    })
    return canceled ? [] : filePaths
  })

  ipcMain.handle('db:all-tracks', () => getAllTracks())

  ipcMain.handle('db:track-by-id', (_e, id: number) => getTrackById(id))

  ipcMain.handle('db:tracks-by-ids', (_e, ids: number[]) => getTracksByIds(ids))

  // ── Artwork ────────────────────────────────────────────
  ipcMain.handle('artwork:path-for', (_e, hash: string | null, size: 'full' | 'thumb') =>
    artworkPathFor(hash, size)
  )

  // TODO: surface in Settings as a manual "Clean up" action
  ipcMain.handle('artwork:sweep-orphaned', () => sweepOrphanedArtwork())

  ipcMain.handle('db:insert-track', (_e, track: Record<string, unknown>) => {
    try {
      const result = insertTrack(track) as { lastInsertRowid: number | bigint }
      const id = Number(result.lastInsertRowid)
      return { ok: true, id }
    } catch (err) {
      console.error('db:insert-track failed:', err)
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('db:update-track-meta', (_e, data: Record<string, unknown>) => {
    try {
      updateTrackMeta(data)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('db:update-board-id', (_e, id: number, boardId: number) => {
    try {
      updateBoardId(id, boardId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('db:tracks-by-board-id', (_e, boardId: number) => getTracksByBoardId(boardId))

  ipcMain.handle('db:mark-missing', (_e, filepath: string) => {
    try {
      markTrackMissing(filepath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sidecar:analyze', async (_e, filepath: string) => {
    try {
      const result = await analyzeFile(filepath)
      return { ok: true, data: result }
    } catch (err) {
      console.error('sidecar:analyze failed:', err)
      return { ok: false, error: (err as Error).message }
    }
  })

  // ── Move files to a folder (job-based — see MoveJob/runMoveJob above) ──

  function createMoveJob(trackIds: number[], destAbsolutePath: string): MoveJob {
    return {
      type: 'move',
      id: randomUUID(),
      trackIds,
      destAbsolutePath,
      cancelRequested: false,
      status: 'running',
      doneCount: 0,
      currentFile: '',
      bytesCopied: 0,
      totalBytes: 0,
      crossDevice: false,
      failed: [],
      lastEmitAt: 0
    }
  }

  function startMoveJob(
    event: Electron.IpcMainInvokeEvent,
    trackIds: number[],
    destAbsolutePath: string
  ): string {
    const job = createMoveJob(trackIds, destAbsolutePath)
    jobs.set(job.id, job)
    runMoveJob(event, job) // fire-and-forget — progress goes out over move:progress
    return job.id
  }

  ipcMain.handle(
    'fs:move-files',
    (event, payload: { trackIds: number[]; destAbsolutePath: string }) => {
      return { jobId: startMoveJob(event, payload.trackIds, payload.destAbsolutePath) }
    }
  )

  // Thin wrapper around fs:move-files for a single file — same input
  // signature as before, but now returns a jobId instead of a final result
  // (moves are async jobs now; MoveFileButton listens for move:progress).
  ipcMain.handle('fs:move-file', (event, fromPath: string, toFolder: string) => {
    const track = getTrackByFilepath(fromPath)
    if (!track) return { ok: false, error: 'Track not found for this file' }
    return { ok: true, jobId: startMoveJob(event, [track.id], toFolder) }
  })

  ipcMain.handle('fs:cancel-move', (_e, jobId: string) => {
    const job = jobs.get(jobId)
    if (!job || job.type !== 'move') {
      return { ok: false, error: 'Unknown or already-finished job' }
    }
    job.cancelRequested = true
    return { ok: true }
  })

  // Pre-move check for the renderer's confirm dialog — one stat on the
  // destination, one per source file (needed anyway for totalBytes, since
  // file_size_mb is never populated on the track row).
  ipcMain.handle('fs:is-cross-device', async (_e, filepaths: string[], destPath: string) => {
    try {
      const destStat = await stat(destPath)
      let totalBytes = 0
      let crossDevice = false
      for (const filepath of filepaths) {
        const s = await stat(filepath)
        totalBytes += s.size
        if (s.dev !== destStat.dev) crossDevice = true
      }
      return { ok: true, crossDevice, totalBytes }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ── Rename a file on disk ────────────────────────────────

  ipcMain.handle('fs:rename-file', async (_e, filepath: string, newName: string) => {
    try {
      // Validate newName — no path separators, no empty string
      if (!newName.trim()) {
        return { ok: false, error: 'Name cannot be empty' }
      }
      if (newName.includes('/') || newName.includes('\\')) {
        return { ok: false, error: 'Name cannot contain slashes' }
      }

      const dir = dirname(filepath)
      const ext = extname(filepath)
      const newPath = join(dir, newName + ext)

      // Check for collision
      try {
        await stat(newPath)
        return { ok: false, error: 'A file with that name already exists' }
      } catch {
        // Good — file does not exist
      }

      await rename(filepath, newPath)

      // Update DB
      updateTrackFilepath(filepath, newPath)

      // Update title in DB to match new filename
      const track = getTrackByFilepath(newPath) as Track | undefined
      if (track) {
        updateTrackMeta({
          id: track.id,
          title: newName,
          artist: track.artist,
          genre: track.genre,
          bpm: track.bpm,
          key_camelot: track.key_camelot,
          energy: track.energy,
          comment: track.comment,
          artwork_path: track.artwork_path,
          needs_sync: track.needs_sync,
          pending_changes: track.pending_changes
        })
      }

      return { ok: true, newPath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ── Create a new folder ──────────────────────────────────

  ipcMain.handle('fs:create-folder', async (_e, parentPath: string, folderName: string) => {
    try {
      if (!folderName.trim()) {
        return { ok: false, error: 'Folder name cannot be empty' }
      }

      const newFolderPath = join(parentPath, folderName)

      // Check for collision
      try {
        await stat(newFolderPath)
        return { ok: false, error: 'A folder with that name already exists' }
      } catch {
        // Good — does not exist
      }

      await mkdir(newFolderPath, { recursive: false })

      // Mirror the new directory into `folders` if it's under a registered
      // root — same self-healing ensureFolderTree call updateTrackFilepath
      // uses for a moved track. Without this, the folder is invisible to
      // FolderView until a full re-import walks it. ensureFolderTree emits
      // folderEvents' 'changed' itself when it inserts a row, forwarded to
      // the renderer as 'folders:changed' — a plain mkdir has no effect on
      // `tracks`, so (unlike a move) nothing else would trigger a refetch.
      const folderId = ensureFolderForDirectory(newFolderPath)

      return {
        ok: true,
        path: newFolderPath,
        folderId,
        reason:
          folderId === null
            ? "Not under a registered library root — this folder won't appear in the library tree"
            : undefined
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ── Classify dropped paths (drag-and-drop from Finder) ────
  // The renderer never guesses a drop's kind from the filename — it always
  // asks main, which knows the real supported-extensions list.
  ipcMain.handle('fs:classify-paths', async (_e, paths: string[]) => {
    const results: { path: string; kind: 'dir' | 'audio' | 'other' }[] = []
    for (const p of paths) {
      try {
        const s = await stat(p)
        if (s.isDirectory()) {
          results.push({ path: p, kind: 'dir' })
        } else if (AUDIO_EXTENSIONS.has(extname(p).toLowerCase())) {
          results.push({ path: p, kind: 'audio' })
        } else {
          results.push({ path: p, kind: 'other' })
        }
      } catch {
        results.push({ path: p, kind: 'other' })
      }
    }
    return results
  })

  // ── Read folder contents ─────────────────────────────────

  ipcMain.handle('fs:read-folder', async (_e, folderPath: string) => {
    try {
      const entries = await readdir(folderPath, { withFileTypes: true })

      const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.aiff', '.aif', '.m4a', '.ogg'])

      const rawItems = await Promise.all(
        entries
          .filter((e) => {
            if (e.name.startsWith('.')) return false // skip hidden files/folders (e.g. macOS ._ AppleDouble files, .DS_Store)
            // Include directories and audio files only
            if (e.isDirectory()) return true
            return AUDIO_EXT.has(extname(e.name).toLowerCase())
          })
          .map(async (e) => {
            const fullPath = join(folderPath, e.name)
            const s = await stat(fullPath)

            if (e.isDirectory()) {
              // Skip folders with no audio anywhere in their subtree
              const audioCount = await countAudioFiles(fullPath)
              if (audioCount === 0) return null

              return {
                name: e.name,
                path: fullPath,
                isDirectory: true,
                size: s.size,
                modified: s.mtimeMs,
                audioCount
              }
            }

            // Already filtered to audio extensions above
            return {
              name: e.name,
              path: fullPath,
              isDirectory: false,
              size: s.size,
              modified: s.mtimeMs,
              audioCount: 1
            }
          })
      )

      const items = rawItems.filter((item): item is NonNullable<typeof item> => item !== null)

      // Folders first, then files, both alphabetical
      items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

      return { ok: true, items }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ── Tags ────────────────────────────────────────────────

  ipcMain.handle('tags:all', () => getAllTags())

  ipcMain.handle('tags:most-used', (_e, limit?: number) => getMostUsedTags(limit))

  ipcMain.handle('tags:for-track', (_e, trackId: number) => getTrackTags(trackId))

  ipcMain.handle('tags:for-tracks', (_e, trackIds: number[]) => getTrackTagsForTracks(trackIds))

  ipcMain.handle('tags:tracks-by-tag', (_e, tagId: number) => getTagTracks(tagId))

  ipcMain.handle('tags:find-or-create', (_e, field: string, value: string, color: string) => {
    try {
      const id = findOrCreateTag(field, value, color)
      return { ok: true, id }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('tags:apply', (_e, trackId: number, tagId: number) => {
    try {
      applyTag(trackId, tagId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('tags:remove', (_e, trackId: number, tagId: number) => {
    try {
      removeTag(trackId, tagId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('tags:check-candidates', (_e, candidates: string[], field: string) =>
    checkCandidates(candidates, field)
  )

  ipcMain.handle(
    'tags:confirm-import',
    (_e, pendingId: number, trackId: number, approvedTags: string[], field: string) => {
      try {
        confirmPendingImport(pendingId, trackId, approvedTags, field)
        return { ok: true }
      } catch (err) {
        console.error('tags:comfirm-import failed', err)
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle('tags:pending', () => getPendingImports())

  // ── Crates ──────────────────────────────────────────────

  ipcMain.handle('crates:all', () => getAllCrates())

  ipcMain.handle('crates:insert', (_e, name: string, color: string) => {
    try {
      const result = insertCrate(name, color)
      return { ok: true, id: Number(result.lastInsertRowid) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('crates:add-track', (_e, crateId: number, trackId: number) => {
    try {
      addTrackToCrate(crateId, trackId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('crates:tracks', (_e, crateId: number) => getCrateTracks(crateId))

  // ── Library roots ────────────────────────────────────────

  ipcMain.handle('db:mark-analyzed', (_e, id: number) => {
    try {
      markTrackAnalyzed(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('roots:all', () => getAllRoots())

  ipcMain.handle('roots:add', async (event, folderPath: string) => {
    try {
      await stat(folderPath) // confirm it exists

      // Check not already nested iinside existing root
      const existingRoots = getAllRoots()
      const alreadyNested = existingRoots.some((r) => isPathUnder(folderPath, r.path))

      if (alreadyNested) {
        return { ok: false, error: 'This folder is already inside a registered library root' }
      }

      // Extract name from path
      const name = basename(folderPath)
      const result = addRoot(name, folderPath)
      const rootId = Number(result.lastInsertRowid)

      // Start watching immediately
      startWatcher(rootId, folderPath)

      // Auto-import in background — same as clicking Import folder
      // Do not await — returns immediately so Settings modal stays responsive
      runFolderImport(event, folderPath)

      return { ok: true, id: rootId }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('roots:remove', (_e, id: number) => {
    try {
      removeRoot(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ── Folders ──────────────────────────────────────────────

  // One subscription covers every ensureFolderTree caller (import, watcher,
  // fs:create-folder, and a track move) — see folderEvents' comment in db.ts.
  folderEvents.on('changed', () => {
    mainWindow?.webContents.send('folders:changed', {})
  })

  ipcMain.handle('folders:tree', (_e, rootId?: number) => getFolderTree(rootId))

  ipcMain.handle('tracks:by-folder', (_e, folderId: number, recursive: boolean) =>
    getTracksByFolder(folderId, recursive)
  )

  ipcMain.handle('tracks:folder-counts', () => getFolderTrackCounts())

  // ── Boards ──────────────────────────────────────────────

  ipcMain.handle('boards:all', () => getAllBoards())

  ipcMain.handle('boards:tracks-by-column', (_e, column: string) => getTracksByColumn(column))

  // ── Settings ─────────────────────────────────────────────

  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    try {
      setSetting(key, value)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ── Set up watcher callbacks ──────────────────────────────

  setWatcherCallbacks({
    // New file detected — auto-import it
    onFileAdded: async (filepath, rootId) => {
      try {
        // Check if already in DB
        const existing = getTrackByFilepath(filepath)
        if (existing) return

        // Fast tag read
        const result = await readTagsFast(filepath)
        if (!result.success) return

        // Resolve the containing directory to a folder id — idempotent and
        // cheap (one directory, not a whole-tree walk) since ensureFolderTree
        // reuses whatever's already registered under this root.
        let folderId: number | null = null
        const root = getAllRoots().find((r) => r.id === rootId)
        if (root) {
          const relDir = relative(root.path, dirname(filepath))
          folderId = ensureFolderTree(rootId, [relDir]).get(relDir) ?? null
        }

        const trackData = buildTrackData(filepath, result, folderId)
        const insertResult = insertTrack(trackData) as { lastInsertRowid: number | bigint }
        const trackId = Number(insertResult.lastInsertRowid)

        if (result.artwork_base64 && trackId > 0) {
          const hash = await storeArtwork(Buffer.from(result.artwork_base64, 'base64'))
          if (hash) setTrackArtworkHash(trackId, hash)
        }

        // Queue as pending change for DJ to review
        insertPendingChange({
          root_id: rootId,
          change_type: 'added',
          old_path: null,
          new_path: filepath,
          track_id: trackId
        })

        // Tell renderer a new track arrived
        mainWindow?.webContents.send('watcher:track-added', {
          trackId,
          filepath
        })

        console.log(`[watcher] auto-imported: ${filepath}`)
      } catch (err) {
        console.error('[watcher] onFileAdded error:', err)
      }
    },

    // File moved — update filepath in DB
    onFileMoved: async (oldPath, newPath, rootId) => {
      try {
        const track = getTrackByFilepath(oldPath)

        // Queue the change for DJ to review
        insertPendingChange({
          root_id: rootId,
          change_type: 'moved',
          old_path: oldPath,
          new_path: newPath,
          track_id: track?.id ?? null
        })

        if (track) {
          // Update filepath immediately — the file is just in a new place
          updateTrackFilepath(oldPath, newPath)

          mainWindow?.webContents.send('watcher:track-moved', {
            trackId: track.id,
            oldPath,
            newPath
          })
        }

        console.log(`[watcher] move accepted: ${oldPath} → ${newPath}`)
      } catch (err) {
        console.error('[watcher] onFileMoved error:', err)
      }
    },

    // File deleted — queue for review
    onFileDeleted: async (filepath, rootId) => {
      try {
        const track = getTrackByFilepath(filepath)

        insertPendingChange({
          root_id: rootId,
          change_type: 'deleted',
          old_path: filepath,
          new_path: null,
          track_id: track?.id ?? null
        })

        mainWindow?.webContents.send('watcher:track-deleted', {
          filepath,
          trackId: track?.id ?? null
        })

        console.log(`[watcher] file deleted: ${filepath}`)
      } catch (err) {
        console.error('[watcher] onFileDeleted error:', err)
      }
    },

    // Root went offline — notify renderer
    onRootOffline: (rootId, rootPath) => {
      console.log(`[watcher] root offline: ${rootPath}`)
      mainWindow?.webContents.send('watcher:root-offline', { rootId, rootPath })
    },

    // Root came back online
    onRootOnline: (rootId, rootPath) => {
      console.log(`[watcher] root online: ${rootPath}`)
      mainWindow?.webContents.send('watcher:root-online', { rootId, rootPath })
    }
  })

  // ── Start watchers for all registered roots ───────────────

  const roots = getAllRoots()

  for (const root of roots) {
    if (root.status === 'online') {
      startWatcher(root.id, root.path)
    }
  }

  ipcMain.handle('watcher:pending-changes', () => getPendingChanges())

  ipcMain.handle('watcher:accept-change', (_e, id: number) => {
    try {
      acceptPendingChange(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('watcher:ignore-change', (_e, id: number) => {
    try {
      ignorePendingChange(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Start/stop watcher when DJ adds/removes a root
  ipcMain.handle('watcher:start', (_e, rootId: number, rootPath: string) => {
    startWatcher(rootId, rootPath)
    return { ok: true }
  })

  ipcMain.handle('watcher:stop', async (_e, rootId: number) => {
    await stopWatcher(rootId)
    return { ok: true }
  })

  createWindow()

  // One-time, best-effort — do not await; must never delay window creation.
  migrateArtworkToContentAddressed().catch((err) => {
    console.error('[artwork migration] unexpected failure:', err)
  })

  // One-time, synchronous (pure SQL, no per-file I/O) — assigns folder_id to
  // tracks imported before the folders table had a writer.
  try {
    backfillTrackFolderIds()
  } catch (err) {
    console.error('[folder backfill] unexpected failure:', err)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', async () => {
  await stopAllWatchers()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
