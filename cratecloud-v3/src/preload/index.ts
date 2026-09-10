import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

interface ImportProgressPayload {
  jobId: string
  phase: 'counting' | 'parsing' | 'done' | 'cancelled' | 'error'
  scanned: number
  total: number
  found: number
  skipped: number
  currentFolder: string
  estimateSeconds?: number
}

// TODO: independently redefined here, in main/index.ts, and in global.d.ts
// — see the same TODO on JobState in useLibraryStore.ts.
interface MoveProgressPayload {
  jobId: string
  phase: 'running' | 'done' | 'cancelled' | 'error'
  done: number
  total: number
  currentFile: string
  bytesCopied: number
  totalBytes: number
  crossDevice: boolean
  failed: { trackId: number; filepath: string; error: string }[]
}

// TODO: independently redefined here, in main/index.ts, and in global.d.ts
// — see the same TODO on JobState in useLibraryStore.ts.
interface CopyProgressPayload {
  jobId: string
  phase: 'running' | 'done' | 'cancelled' | 'error'
  done: number
  total: number
  currentFile: string
  bytesCopied: number
  totalBytes: number
  failed: { sourcePath: string; error: string }[]
  deleteSource: boolean
}

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
  cancelImport: (jobId: string) => ipcRenderer.invoke('import:cancel', jobId),
  resumeImport: (jobId: string) => ipcRenderer.invoke('import:resume', jobId),
  onImportProgress: (cb: (p: ImportProgressPayload) => void) =>
    ipcRenderer.on('import:progress', (_e, p) => cb(p)),
  onImportBatchCommitted: (cb: (data: { jobId: string }) => void) =>
    ipcRenderer.on('import:batch-committed', (_e, d) => cb(d)),
  offImportProgress: () => {
    ipcRenderer.removeAllListeners('import:progress')
    ipcRenderer.removeAllListeners('import:batch-committed')
  },
  onTrackAnalyzed: (
    cb: (data: {
      trackId: number
      bpm: number | null
      key_camelot: string | null
      key_full: string | null
      duration_sec: number | null
      duration_str: string | null
      done: number
      total: number
    }) => void
  ) => ipcRenderer.on('library:track-analyzed', (_e, d) => cb(d)),
  onAnalysisComplete: (cb: (data: { analyzed: number; total: number }) => void) =>
    ipcRenderer.on('library:analysis-complete', (_e, d) => cb(d)),

  onTrackAdded: (cb: (data: { trackId: number; filepath: string }) => void) =>
    ipcRenderer.on('watcher:track-added', (_e, d) => cb(d)),
  onTrackMoved: (cb: (data: { trackId: number; oldPath: string; newPath: string }) => void) =>
    ipcRenderer.on('watcher:track-moved', (_e, d) => cb(d)),
  onTrackDeleted: (cb: (data: { filepath: string; trackId: number | null }) => void) =>
    ipcRenderer.on('watcher:track-deleted', (_e, d) => cb(d)),
  onRootOffline: (cb: (data: { rootId: number; rootPath: string }) => void) =>
    ipcRenderer.on('watcher:root-offline', (_e, d) => cb(d)),
  onRootOnline: (cb: (data: { rootId: number; rootPath: string }) => void) =>
    ipcRenderer.on('watcher:root-online', (_e, d) => cb(d)),
  offWatcherListeners: () => {
    ipcRenderer.removeAllListeners('watcher:track-added')
    ipcRenderer.removeAllListeners('watcher:track-moved')
    ipcRenderer.removeAllListeners('watcher:track-deleted')
    ipcRenderer.removeAllListeners('watcher:root-offline')
    ipcRenderer.removeAllListeners('watcher:root-online')
  },

  offAnalysisListeners: () => {
    ipcRenderer.removeAllListeners('library:track-analyzed')
    ipcRenderer.removeAllListeners('library:analysis-complete')
  },
  // Tracks
  db: {
    allTracks: () => ipcRenderer.invoke('db:all-tracks'),
    trackById: (id: number) => ipcRenderer.invoke('db:track-by-id', id),
    insertTrack: (track: unknown) => ipcRenderer.invoke('db:insert-track', track),
    updateTrackMeta: (data: unknown) => ipcRenderer.invoke('db:update-track-meta', data),
    updateBoardId: (id: number, boardId: number) =>
      ipcRenderer.invoke('db:update-board-id', id, boardId),
    tracksByBoardId: (boardId: number) => ipcRenderer.invoke('db:tracks-by-board-id', boardId),
    markMissing: (filepath: string) => ipcRenderer.invoke('db:mark-missing', filepath),
    markAnalyzed: (id: number) => ipcRenderer.invoke('db:mark-analyzed', id),
    tracksByFolder: (folderId: number, recursive: boolean) =>
      ipcRenderer.invoke('tracks:by-folder', folderId, recursive),
    folderTrackCounts: () => ipcRenderer.invoke('tracks:folder-counts'),
    tracksByIds: (ids: number[]) => ipcRenderer.invoke('db:tracks-by-ids', ids)
  },

  // Folders
  folders: {
    tree: (rootId?: number) => ipcRenderer.invoke('folders:tree', rootId)
  },

  onFoldersChanged: (cb: () => void) => ipcRenderer.on('folders:changed', () => cb()),
  offFoldersChanged: () => ipcRenderer.removeAllListeners('folders:changed'),

  // Tags
  tags: {
    all: () => ipcRenderer.invoke('tags:all'),
    mostUsed: (limit?: number) => ipcRenderer.invoke('tags:most-used', limit),
    forTrack: (trackId: number) => ipcRenderer.invoke('tags:for-track', trackId),
    forTracks: (trackIds: number[]) => ipcRenderer.invoke('tags:for-tracks', trackIds),
    tracksByTag: (tagId: number) => ipcRenderer.invoke('tags:tracks-by-tag', tagId),
    apply: (trackId: number, tagId: number) => ipcRenderer.invoke('tags:apply', trackId, tagId),
    remove: (trackId: number, tagId: number) => ipcRenderer.invoke('tags:remove', trackId, tagId),
    checkCandidates: (candidates: string[], field: string) =>
      ipcRenderer.invoke('tags:check-candidates', candidates, field),
    confirmImport: (pendingId: number, trackId: number, approvedTags: string[], field: string) =>
      ipcRenderer.invoke('tags:confirm-import', pendingId, trackId, approvedTags, field),
    pending: () => ipcRenderer.invoke('tags:pending'),
    findOrCreate: (field: string, value: string, color: string) =>
      ipcRenderer.invoke('tags:find-or-create', field, value, color)
  },

  // Crates
  crates: {
    all: () => ipcRenderer.invoke('crates:all'),
    insert: (name: string, color: string) => ipcRenderer.invoke('crates:insert', name, color),
    addTrack: (crateId: number, trackId: number) =>
      ipcRenderer.invoke('crates:add-track', crateId, trackId),
    tracks: (crateId: number) => ipcRenderer.invoke('crates:tracks', crateId)
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

  // Artwork — the renderer never builds artwork paths itself, only asks for
  // a hash + size and gets back a ready-to-use path (or null if missing).
  artwork: {
    pathFor: (hash: string | null, size: 'full' | 'thumb') =>
      ipcRenderer.invoke('artwork:path-for', hash, size),
    sweepOrphaned: () => ipcRenderer.invoke('artwork:sweep-orphaned')
  },
  fs: {
    // Job-based — see MoveJob/runMoveJob in main/index.ts. Both resolve
    // immediately with a jobId; progress comes over onMoveProgress.
    moveFile: (from: string, to: string) => ipcRenderer.invoke('fs:move-file', from, to),
    moveFiles: (payload: { trackIds: number[]; destAbsolutePath: string }) =>
      ipcRenderer.invoke('fs:move-files', payload),
    cancelMove: (jobId: string) => ipcRenderer.invoke('fs:cancel-move', jobId),
    isCrossDevice: (filepaths: string[], destPath: string) =>
      ipcRenderer.invoke('fs:is-cross-device', filepaths, destPath),
    renameFile: (filepath: string, newName: string) =>
      ipcRenderer.invoke('fs:rename-file', filepath, newName),
    createFolder: (parent: string, name: string) =>
      ipcRenderer.invoke('fs:create-folder', parent, name),
    readFolder: (folderPath: string) => ipcRenderer.invoke('fs:read-folder', folderPath),
    // Drag-and-drop from Finder — classify what was dropped (never guess
    // from the filename in the renderer), and copy-then-import a drop into
    // a specific folder. Job-based like move: resolves with a jobId,
    // progress comes over onCopyProgress.
    classifyPaths: (paths: string[]) => ipcRenderer.invoke('fs:classify-paths', paths),
    copyIntoFolder: (payload: {
      sourcePaths: string[]
      destAbsolutePath: string
      currentFolderPath: string
      deleteSource?: boolean
    }) => ipcRenderer.invoke('fs:copy-into-folder', payload),
    cancelCopy: (jobId: string) => ipcRenderer.invoke('fs:cancel-copy', jobId)
  },
  onMoveProgress: (cb: (p: MoveProgressPayload) => void) =>
    ipcRenderer.on('move:progress', (_e, p) => cb(p)),
  offMoveProgress: () => ipcRenderer.removeAllListeners('move:progress'),
  onCopyProgress: (cb: (p: CopyProgressPayload) => void) =>
    ipcRenderer.on('copy:progress', (_e, p) => cb(p)),
  offCopyProgress: () => ipcRenderer.removeAllListeners('copy:progress'),
  // Modern Electron removed File.path — the renderer must resolve a
  // dropped File's real path through the preload/main process instead.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  watcher: {
    pendingChanges: () => ipcRenderer.invoke('watcher:pending-changes'),
    acceptChange: (id: number) => ipcRenderer.invoke('watcher:accept-change', id),
    ignoreChange: (id: number) => ipcRenderer.invoke('watcher:ignore-change', id),
    start: (rootId: number, rootPath: string) =>
      ipcRenderer.invoke('watcher:start', rootId, rootPath),
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
