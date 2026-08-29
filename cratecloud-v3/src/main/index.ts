import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  insertTrack,
  getAllTracks,
  getTrackById,
  updateTrackMeta,
  markTrackMissing,
  getAllTags,
  //findOrCreateTag,
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
  updateBoardColumn,
  getSetting,
  setSetting
} from './db'
import { analyzeFile } from './sidecar'

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

  ipcMain.handle('db:update-board-column', (_e, id: number, column: string) => {
    try {
      updateBoardColumn(id, column)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

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
