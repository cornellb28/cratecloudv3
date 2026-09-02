import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname, basename } from 'path'
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
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
  getTracksByBoardId
} from './db'
import { analyzeFile } from './sidecar'

console.log('DB path:', join(app.getPath('userData'), 'cratecloud', 'library.db'))

// ── Walk a folder and find all audio files ──────────────────────────────────────────────
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aiff', '.aif', '.m4a', '.ogg'])
function walkFolder(folderPath: string): string[] {
  const results: string[] = []

  function walk(dir: string): void {
    const entries = readdirSync(dir)
    for (const entry of entries) {
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

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
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
      const concurrency = 4

      // 2. Process in batches of 4
      for (let i = 0; i < filepaths.length; i += concurrency) {
        const batch = filepaths.slice(i, i + concurrency)

        await Promise.all(
          batch.map(async (filepath) => {
            try {
              // Analyze the file
              const analysisResult = await analyzeFile(filepath)

              if (!analysisResult.success) {
                failed++
                return
              }

              // Save to SQLite
              const trackData = {
                filepath,
                filename: basename(filepath),
                title: analysisResult.title,
                artist: analysisResult.artist,
                album: analysisResult.album,
                genre: analysisResult.genre,
                year: analysisResult.year,
                comment: analysisResult.comment,
                label: analysisResult.label,
                remixer: analysisResult.remixer,
                composer: analysisResult.composer,
                grouping: analysisResult.grouping,
                bpm: analysisResult.bpm,
                key_camelot: analysisResult.key_camelot,
                key_full: analysisResult.key_full,
                camelot: analysisResult.camelot,
                duration_sec: analysisResult.duration_sec,
                duration_str: analysisResult.duration_str,
                analyzed_at: new Date().toISOString()
              }

              // Insert track into SQLite
              const result = insertTrack(trackData) as { lastInsertRowid: number | bigint }
              const trackId = Number(result.lastInsertRowid)

              // Save artwork to disk if present
              if (analysisResult.artwork_base64 && trackId > 0) {
                const artworkPath = saveArtwork(trackId, analysisResult.artwork_base64)
                if (artworkPath) {
                  updateTrackMeta({
                    id: trackId,
                    artwork_path: artworkPath,
                    title: trackData.title,
                    artist: trackData.artist,
                    genre: trackData.genre,
                    bpm: trackData.bpm,
                    key_camelot: trackData.key_camelot,
                    energy: null,
                    comment: trackData.comment,
                    needs_sync: 0,
                    pending_changes: null,
                  })
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

      return { ok: true, imported, failed, total }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
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
