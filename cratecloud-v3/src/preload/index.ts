import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'


// Custom APIs for renderer
const api = {
  // ── Audio analysis ─────────────────────────────────────────────────────
  // TODO: return string[] when multi-folder import is built in Phase 5
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:open-folder'),
  analyzeFile: (filepath: string) => ipcRenderer.invoke('sidecar:analyze', filepath),
  importFolder: (folderPath: string) => ipcRenderer.invoke('library:import-folder', folderPath),
  onImportProgress: ( cb: (p: { done: number; total: number; failed: number; filepath: string }) => void ) => ipcRenderer.on('library:import-progress', (_e, p) => cb(p)),
  offImportProgress: () => ipcRenderer.removeAllListeners('library:import-progress'),
  getArtworkUrl: (filepath: string) => `file://${filepath}`,
  // Tracks
  db: {
    allTracks: () => ipcRenderer.invoke('db:all-tracks'),
    trackById: (id: number) => ipcRenderer.invoke('db:track-by-id', id),
    insertTrack: (track: unknown) => ipcRenderer.invoke('db:insert-track', track),
    updateTrackMeta: (data: unknown) => ipcRenderer.invoke('db:update-track-meta', data),
    updateBoardId: (id: number, boardId: number) => ipcRenderer.invoke('db:update-board-id', id, boardId),
    tracksByBoardId: (boardId: number) => ipcRenderer.invoke('db:tracks-by-board-id', boardId),
    markMissing: (filepath: string) => ipcRenderer.invoke('db:mark-missing', filepath)
  },

  // Tags
  tags: {
    all: () => ipcRenderer.invoke('tags:all'),
    forTrack: (trackId: number) => ipcRenderer.invoke('tags:for-track', trackId),
    tracksByTag: (tagId: number) => ipcRenderer.invoke('tags:tracks-by-tag', tagId),
    apply: (trackId: number, tagId: number) => ipcRenderer.invoke('tags:apply', trackId, tagId),
    remove: (trackId: number, tagId: number) => ipcRenderer.invoke('tags:remove', trackId, tagId),
    checkCandidates: (candidates: string[], field: string) => ipcRenderer.invoke('tags:check-candidates', candidates, field),
    confirmImport: (pendingId: number, trackId: number, approvedTags: string[], field: string) => ipcRenderer.invoke('tags:confirm-import', pendingId, trackId, approvedTags, field),
    pending: () => ipcRenderer.invoke('tags:pending')
  },

  // Crates
  crates: {
    all: () => ipcRenderer.invoke('crates:all'),
    insert: (name: string, color: string) => ipcRenderer.invoke('crates:insert', name, color),
    addTrack: (crateId: number, trackId: number) => ipcRenderer.invoke('crates:add-track', crateId, trackId),
    tracks: (crateId: number) => ipcRenderer.invoke('crates:tracks', crateId),
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
