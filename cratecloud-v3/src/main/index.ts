import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import { join, extname, basename, dirname } from 'path'
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { rename, stat, copyFile, unlink, mkdir, readdir } from 'fs/promises'
import {
  insertTrack,
  getAllTracks,
  getTrackById,
  updateTrackMeta,
  markTrackMissing,
  getAllTags,
  applyTag,
  removeTag,
  getTrackTags,
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
  getUnanalyzedTracks,
  updateArtworkPath,
  updateTrackFilepath,
  getTrackByFilepath,
  markTrackAnalyzed
} from './db'
import { analyzeFile, readTagsFast } from './sidecar'

// console.log('DB path:', join(app.getPath('userData'), 'cratecloud', 'library.db'))

// ── Walk a folder and find all audio files ──────────────────────────────────────────────
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aiff', '.aif', '.m4a', '.ogg'])
function walkFolder(folderPath: string): string[] {
  const results: string[] = []

  function walk(dir: string): void {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (entry.startsWith('.')) continue // skip hidden files/folders (e.g. macOS ._ AppleDouble files, .DS_Store)
      const fullPath = join(dir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          walk(fullPath) // recurse into subfolders
        } else if (AUDIO_EXTENSIONS.has(extname(entry).toLowerCase())) {
          results.push(fullPath) // audio file found
        }
      } catch {
        // skip files we cannot read
      }
    }
  }

  walk(folderPath)
  return results
}

function saveArtwork(trackId: number, base64Data: string): string | null {
  try {
    const artworkDir = join(app.getPath('userData'), 'cratecloud', 'artwork')
    mkdirSync(artworkDir, { recursive: true })

    const filepath = join(artworkDir, `${trackId}.jpg`)
    const buffer = Buffer.from(base64Data, 'base64')
    writeFileSync(filepath, buffer)
    return filepath
  } catch {
    return null
  }
}

// Build a consistent track data object from analysis result
function buildTrackData(filepath: string, result: AnalysisResult): {
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
    board_id: 1
  }
}

// move files to folders
async function moveFileToFolder(fromPath: string, toFolder: string): Promise<string> {
  const ext = extname(fromPath)
  const base = basename(fromPath, ext)
  let toPath = join(toFolder, basename(fromPath))
  let counter = 1

  // Collision detection - find a free filename at the destination
  while (true) {
    try {
      await stat(toPath)
      // stat succeeded -> file exists -> try next name
      toPath = join(toFolder, `${base} (${counter++}${ext})`)
    } catch {
      // stat threw -> path does not exist -> safe to use
    }
    if (counter > 99) {
      throw new Error('Too many filename collisions at destination')
    }
  }

  try {
    await rename(fromPath, toPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      // Cross-device move - copy then verify than delete
      const sourceSize = (await stat(fromPath)).size
      await copyFile(fromPath, toPath)
      const copiedSize = (await stat(toPath)).size

      if (copiedSize !== sourceSize) {
        await unlink(toPath).catch(() => { })
        throw new Error(
          `Copy verification failed (${copiedSize} bytes copied, ` + `expected ${sourceSize}) — source left untouched`
        )
      }

      await unlink(fromPath)
    } else {
      throw err
    }
  }
  return toPath
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
      bypassCSP: true,
    }
  }
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // ── Register a custom protocol for serving local artwork ──────────────────────────────────────────────
  protocol.handle('artwork', (request) => {
    const url = request.url.replace('artwork://', '')
    const decodedPath = decodeURIComponent(url)
    return net.fetch(pathToFileURL(decodedPath).toString())
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
      // 1. Find all audio files
      const filepaths = walkFolder(folderPath)
      const total = filepaths.length

      if (total === 0) {
        return { ok: true, imported: 0, message: 'No audio files found' }
      }

      let imported = 0
      let failed = 0
      const concurrency = 8

      // 2. Process in batches of 4
      for (let i = 0; i < filepaths.length; i += concurrency) {
        const batch = filepaths.slice(i, i + concurrency)

        await Promise.all(
          batch.map(async (filepath) => {
            try {
              // Analyze the file
              const result = await readTagsFast(filepath)

              if (!result.success) {
                failed++
                return
              }

              // Save to SQLite
              const trackData = buildTrackData(filepath, result)

              // Insert track into SQLite
              const insertResult = insertTrack(trackData) as { lastInsertRowid: number | bigint }
              const trackId = Number(insertResult.lastInsertRowid)

              // Save artwork to disk if present
              if (result.artwork_base64 && trackId > 0) {
                const artworkPath = saveArtwork(trackId, result.artwork_base64)
                if (artworkPath) {
                  updateArtworkPath(trackId, artworkPath)
                }
              }

              imported++

              // Send progress to the renderer after each file
              // The renderer uses this to update the progress bar
              event.sender.send('library:import-progress', {
                done: imported,
                total,
                failed,
                filepath: basename(filepath)
              })
            } catch {
              failed++
            }
          })
        )
      }

      // Tell renderer Phase 1 is done — tracks are visible
      event.sender.send('library:phase1-complete', { imported, total, failed })

      // Phase 2 — analyze in background (BPM + key)
      // Do not await — runs after handler returns
      runPhase2Analysis(event)

      return { ok: true, imported, failed, total }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  async function importSingleFile( event: Electron.IpcMainInvokeEvent, filepath: string ): Promise<{ ok: boolean; trackId?: number; error?: string }> {
    try {
      // Phase 1
      const fastResult = await readTagsFast(filepath)
      const trackData = buildTrackData(filepath, fastResult)
      const insertResult = insertTrack(trackData) as { lastInsertRowid: number | bigint }
      const trackId = Number(insertResult.lastInsertRowid)

      if (fastResult.artwork_base64 && trackId > 0) {
        const artworkPath = saveArtwork(trackId, fastResult.artwork_base64)
        if (artworkPath) updateArtworkPath(trackId, artworkPath)
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

  async function runPhase2Analysis(event: Electron.IpcMainInvokeEvent): Promise<void> {
    // Only analyze tracks that Phase 1 did not already resolve
    // (tracks that had BPM/key tags skip librosa entirely)
    const unanalyzed = getUnanalyzedTracks() as Track[]

    if (unanalyzed.length === 0) {
      event.sender.send('library:analysis-complete', {
        analyzed: 0,
        total: 0,
      })
      return
    }

    const total = unanalyzed.length
    let done = 0
    const concurrency = 4  // librosa is heavy — keep this lower

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
                pending_changes: null,
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
                total,
              })
            }
          } catch {
            // Skip failed analysis — track still visible without BPM
            done++
          }
        })
      )
    }

    event.sender.send('library:analysis-complete', {
      analyzed: done,
      total,
    })
  }

  ipcMain.handle('library:import-file', async (event, filepath: string) => {
    return importSingleFile(event, filepath)
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
      ],
    })
    return canceled ? [] : filePaths
  })

  ipcMain.handle('db:all-tracks', () => getAllTracks())

  ipcMain.handle('db:track-by-id', (_e, id: number) => getTrackById(id))

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

  // ── Move a single file to a folder ──────────────────────

  ipcMain.handle('fs:move-file',
    async (_e, fromPath: string, toFolder: string) => {
      try {
        // Validate — source must exist
        await stat(fromPath)

        // Validate — destination must be a directory
        const destStat = await stat(toFolder)
        if (!destStat.isDirectory()) {
          return { ok: false, error: 'Destination is not a folder' }
        }

        // Move the file
        const newPath = await moveFileToFolder(fromPath, toFolder)

        // Update DB — filepath changed
        updateTrackFilepath(fromPath, newPath)

        return { ok: true, newPath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  // ── Move multiple files to a folder ─────────────────────

  ipcMain.handle('fs:move-files',
    async (_e, fromPaths: string[], toFolder: string) => {
      const results: { path: string; ok: boolean; newPath?: string; error?: string }[] = []

      for (const fromPath of fromPaths) {
        try {
          const newPath = await moveFileToFolder(fromPath, toFolder)
          updateTrackFilepath(fromPath, newPath)
          results.push({ path: fromPath, ok: true, newPath })
        } catch (err) {
          results.push({
            path: fromPath,
            ok: false,
            error: (err as Error).message,
          })
        }
      }

      const succeeded = results.filter(r => r.ok).length
      const failed = results.filter(r => !r.ok).length

      return { ok: true, succeeded, failed, results }
    }
  )

  // ── Rename a file on disk ────────────────────────────────

  ipcMain.handle('fs:rename-file',
    async (_e, filepath: string, newName: string) => {
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
            pending_changes: track.pending_changes,
          })
        }

        return { ok: true, newPath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  // ── Create a new folder ──────────────────────────────────

  ipcMain.handle('fs:create-folder',
    async (_e, parentPath: string, folderName: string) => {
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
        return { ok: true, path: newFolderPath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  // ── Read folder contents ─────────────────────────────────

  ipcMain.handle('fs:read-folder',
    async (_e, folderPath: string) => {
      try {
        const entries = await readdir(folderPath, { withFileTypes: true })

        const AUDIO_EXT = new Set([
          '.mp3', '.flac', '.wav', '.aiff', '.aif', '.m4a', '.ogg'
        ])

        const items = await Promise.all(
          entries
            .filter(e => {
              // Include directories and audio files only
              if (e.isDirectory()) return true
              return AUDIO_EXT.has(extname(e.name).toLowerCase())
            })
            .map(async (e) => {
              const fullPath = join(folderPath, e.name)
              const s = await stat(fullPath)
              return {
                name: e.name,
                path: fullPath,
                isDirectory: e.isDirectory(),
                size: s.size,
                modified: s.mtimeMs,
              }
            })
        )

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
    }
  )

  // ── Tags ────────────────────────────────────────────────

  ipcMain.handle('tags:all', () => getAllTags())

  ipcMain.handle('tags:for-track', (_e, trackId: number) => getTrackTags(trackId))

  ipcMain.handle('tags:tracks-by-tag', (_e, tagId: number) => getTagTracks(tagId))

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

  ipcMain.handle('tags:check-candidates', (_e, candidates: string[], field: string) => checkCandidates(candidates, field))

  ipcMain.handle('tags:confirm-import', (_e, pendingId: number, trackId: number, approvedTags: string[], field: string) => {
    try {
      confirmPendingImport(pendingId, trackId, approvedTags, field)
      return { ok: true }
    } catch (err) {
      console.error('tags:comfirm-import failed', err)
      return { ok: false, error: (err as Error).message }
    }
  })

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

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
