import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // ── Audio analysis ─────────────────────────────────────────────────────
  // TODO: return string[] when multi-folder import is built in Phase 5
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:open-folder'),
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:open-files'),
  importFile: (filepath: string) => ipcRenderer.invoke('library:import-file', filepath),
  importFiles: (filepaths: string[]) => ipcRenderer.invoke('library:import-files', filepaths),
  analyzeFile: (filepath: string) => ipcRenderer.invoke('sidecar:analyze', filepath),
  importFolder: (folderPath: string) => ipcRenderer.invoke('library:import-folder', folderPath),
  onImportProgress: (cb: (p: { done: number; total: number; failed: number; filepath: string }) => void) => ipcRenderer.on('library:import-progress', (_e, p) => cb(p)),
  offImportProgress: () => {
    ipcRenderer.removeAllListeners('library:import-progress')
    ipcRenderer.removeAllListeners('library:phase1-complete')
  },
  onTrackAnalyzed: (cb: (data: {
    trackId: number
    bpm: number | null
    key_camelot: string | null
    key_full: string | null
    duration_sec: number | null
    duration_str: string | null
    done: number
    total: number
  }) => void) => ipcRenderer.on('library:track-analyzed', (_e, d) => cb(d)),
  onPhase1Complete: (cb: (data: { imported: number, total: number, failed: number }) => void) => ipcRenderer.on('library:phase1-complete', (_e, d) => cb(d)),
  onAnalysisComplete: (cb: (data: { analyzed: number, total: number }) => void) => ipcRenderer.on('library:analysis-complete', (_e, d) => cb(d)),

  onTrackAdded: (cb: (data: { trackId: number; filepath: string }) => void) => ipcRenderer.on('watcher:track-added', (_e, d) => cb(d)),
  onTrackMoved: (cb: (data: { trackId: number; oldPath: string; newPath: string }) => void) => ipcRenderer.on('watcher:track-moved', (_e, d) => cb(d)),
  onTrackDeleted: (cb: (data: { filepath: string; trackId: number | null }) => void) => ipcRenderer.on('watcher:track-deleted', (_e, d) => cb(d)),
  onRootOffline: (cb: (data: { rootId: number; rootPath: string }) => void) => ipcRenderer.on('watcher:root-offline', (_e, d) => cb(d)),
  onRootOnline: (cb: (data: { rootId: number; rootPath: string }) => void) => ipcRenderer.on('watcher:root-online', (_e, d) => cb(d)),
  offWatcherListeners: () => {
    ipcRenderer.removeAllListeners('watcher:track-added')
    ipcRenderer.removeAllListeners('watcher:track-moved')
    ipcRenderer.removeAllListeners('watcher:track-deleted')
    ipcRenderer.removeAllListeners('watcher:root-offline')
    ipcRenderer.removeAllListeners('watcher:root-online')
  },

  offAnalysisListeners: () => {
    ipcRenderer.removeAllListeners('library:track-analyzed')
    ipcRenderer.removeAllListeners('library:phase1-complete')
    ipcRenderer.removeAllListeners('library:analysis-complete')
  },
  getArtworkUrl: (filepath: string) => `artwork://${filepath}`,
  // Tracks
  db: {
    allTracks: () => ipcRenderer.invoke('db:all-tracks'),
    trackById: (id: number) => ipcRenderer.invoke('db:track-by-id', id),
    insertTrack: (track: unknown) => ipcRenderer.invoke('db:insert-track', track),
    updateTrackMeta: (data: unknown) => ipcRenderer.invoke('db:update-track-meta', data),
    updateBoardId: (id: number, boardId: number) => ipcRenderer.invoke('db:update-board-id', id, boardId),
    tracksByBoardId: (boardId: number) => ipcRenderer.invoke('db:tracks-by-board-id', boardId),
    markMissing: (filepath: string) => ipcRenderer.invoke('db:mark-missing', filepath),
    markAnalyzed: (id: number) => ipcRenderer.invoke('db:mark-analyzed', id)
  },

  // Tags
  tags: {
    all: () => ipcRenderer.invoke('tags:all'),
    mostUsed: (limit?: number) => ipcRenderer.invoke('tags:most-used', limit),
    forTrack: (trackId: number) => ipcRenderer.invoke('tags:for-track', trackId),
    forTracks: (trackIds: number[]) => ipcRenderer.invoke('tags:for-tracks', trackIds),
    tracksByTag: (tagId: number) => ipcRenderer.invoke('tags:tracks-by-tag', tagId),
    apply: (trackId: number, tagId: number) => ipcRenderer.invoke('tags:apply', trackId, tagId),
    remove: (trackId: number, tagId: number) => ipcRenderer.invoke('tags:remove', trackId, tagId),
    checkCandidates: (candidates: string[], field: string) => ipcRenderer.invoke('tags:check-candidates', candidates, field),
    confirmImport: (pendingId: number, trackId: number, approvedTags: string[], field: string) => ipcRenderer.invoke('tags:confirm-import', pendingId, trackId, approvedTags, field),
    pending: () => ipcRenderer.invoke('tags:pending'),
    findOrCreate: (field: string, value: string, color: string) => ipcRenderer.invoke('tags:find-or-create', field, value, color)
  },

  // Crates
  crates: {
    all: () => ipcRenderer.invoke('crates:all'),
    insert: (name: string, color: string) => ipcRenderer.invoke('crates:insert', name, color),
    addTrack: (crateId: number, trackId: number) => ipcRenderer.invoke('crates:add-track', crateId, trackId),
    tracks: (crateId: number) => ipcRenderer.invoke('crates:tracks', crateId),
  },

  // Library roots
  roots: {
    all: () => ipcRenderer.invoke('roots:all'),
    add: (folderPath: string) => ipcRenderer.invoke('roots:add', folderPath),
    remove: (id: number) => ipcRenderer.invoke('roots:remove', id)
  },

  // Boards
  boards: {
    all: () => ipcRenderer.invoke('boards:all'),
    tracksByColumn: (column: string) => ipcRenderer.invoke('boards:tracks-by-column', column)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },
  fs: {
    moveFile: (from: string, to: string) => ipcRenderer.invoke('fs:move-file', from, to),
    moveFiles: (from: string[], to: string) => ipcRenderer.invoke('fs:move-files', from, to),
    renameFile: (filepath: string, newName: string) => ipcRenderer.invoke('fs:rename-file', filepath, newName),
    createFolder: (parent: string, name: string) => ipcRenderer.invoke('fs:create-folder', parent, name),
    readFolder: (folderPath: string) => ipcRenderer.invoke('fs:read-folder', folderPath),
  },
  watcher: {
    pendingChanges: () => ipcRenderer.invoke('watcher:pending-changes'),
    acceptChange: (id: number) => ipcRenderer.invoke('watcher:accept-change', id),
    ignoreChange: (id: number) => ipcRenderer.invoke('watcher:ignore-change', id),
    start: (rootId: number, rootPath: string) => ipcRenderer.invoke('watcher:start', rootId, rootPath),
    stop: (rootId: number) => ipcRenderer.invoke('watcher:stop', rootId)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
