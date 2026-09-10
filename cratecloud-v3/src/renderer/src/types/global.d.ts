export {}

declare global {
  interface Window {
    api: {
      openFolder: () => Promise<string | null>
      openFiles: () => Promise<string[]>
      importFile: (filepath: string) => Promise<{ ok: boolean; trackId?: number; error?: string }>
      importFiles: (filepaths: string[]) => Promise<{
        ok: boolean
        count: number
        results: { ok: boolean; trackId?: number; error?: string }[]
      }>
      analyzeFile: (filepath: string) => Promise<{
        ok: boolean
        data?: AnalysisResult
        error?: string
      }>

      importFolder: (folderPath: string) => Promise<{
        ok: boolean
        imported?: number
        failed?: number
        total?: number
        jobId?: string
        cancelled?: boolean
        message?: string
        error?: string
      }>

      cancelImport: (jobId: string) => Promise<{ ok: boolean; error?: string }>
      resumeImport: (jobId: string) => Promise<{
        ok: boolean
        imported?: number
        failed?: number
        total?: number
        jobId?: string
        cancelled?: boolean
        error?: string
      }>

      onImportProgress: (cb: (p: ImportProgressPayload) => void) => void

      onImportBatchCommitted: (cb: (data: { jobId: string }) => void) => void

      offImportProgress: () => void

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
      ) => void

      onAnalysisComplete: (cb: (data: { analyzed: number; total: number }) => void) => void

      offAnalysisListeners: () => void

      onTrackAdded: (cb: (data: { trackId: number; filepath: string }) => void) => void
      onTrackMoved: (
        cb: (data: { trackId: number; oldPath: string; newPath: string }) => void
      ) => void
      onTrackDeleted: (cb: (data: { filepath: string; trackId: number | null }) => void) => void
      onRootOffline: (cb: (data: { rootId: number; rootPath: string }) => void) => void
      onRootOnline: (cb: (data: { rootId: number; rootPath: string }) => void) => void
      offWatcherListeners: () => void

      db: {
        allTracks: () => Promise<Track[]>
        trackById: (id: number) => Promise<Track | null>
        insertTrack: (
          track: Partial<Track>
        ) => Promise<{ ok: boolean; id?: number; error?: string }>
        updateTrackMeta: (
          data: Partial<Track> & { id: number }
        ) => Promise<{ ok: boolean; error?: string }>
        updateBoardId: (id: number, boardId: number) => Promise<{ ok: boolean; error?: string }>
        tracksByBoardId: (id: number, boardId: number) => Promise<Track[]>
        markMissing: (filepath: string) => Promise<{ ok: boolean; error?: string }>
        markAnalyzed: (id: number) => Promise<{ ok: boolean; error?: string }>
        tracksByFolder: (folderId: number, recursive: boolean) => Promise<Track[]>
        folderTrackCounts: () => Promise<{ folder_id: number; count: number }[]>
        tracksByIds: (ids: number[]) => Promise<Track[]>
      }

      folders: {
        tree: (rootId?: number) => Promise<FolderRow[]>
      }

      onMoveProgress: (cb: (p: MoveProgressPayload) => void) => void
      offMoveProgress: () => void

      watcher: {
        pendingChanges: () => Promise<PendingChange[]>
        acceptChange: (id: number) => Promise<{ ok: boolean; error?: string }>
        ignoreChange: (id: number) => Promise<{ ok: boolean; error?: string }>
        start: (rootId: number, rootPath: string) => Promise<{ ok: boolean }>
        stop: (rootId: number) => Promise<{ ok: boolean }>
      }

      tags: {
        all: () => Promise<Tag[]>
        mostUsed: (limit?: number) => Promise<Tag[]>
        forTrack: (trackId: number) => Promise<Tag[]>
        forTracks: (trackIds: number[]) => Promise<Record<number, Tag[]>>
        tracksByTag: (tagId: number) => Promise<Track[]>
        apply: (trackId: number, tagId: number) => Promise<{ ok: boolean; error?: string }>
        remove: (trackId: number, tagId: number) => Promise<{ ok: boolean; error?: string }>
        checkCandidates: (candidates: string[], field: string) => Promise<TagCandidate[]>
        confirmImport: (
          pendingId: number,
          trackId: number,
          approvedTags: string[],
          field: string
        ) => Promise<{ ok: boolean; error?: string }>
        pending: () => Promise<PendingImport[]>
        findOrCreate: (
          field: string,
          value: string,
          color: string
        ) => Promise<{ ok: boolean; id?: number; error?: string }>
      }

      roots: {
        all: () => Promise<LibraryRoot[]>
        add: (folderPath: string) => Promise<{ ok: boolean; id?: number; error?: string }>
        remove: (id: number) => Promise<{ ok: boolean; error?: string }>
      }

      crates: {
        all: () => Promise<Crate[]>
        insert: (
          name: string,
          color: string
        ) => Promise<{ ok: boolean; id?: number; error?: string }>
        addTrack: (crateId: number, trackId: number) => Promise<{ ok: boolean; error?: string }>
        tracks: (crateId: number) => Promise<Track[]>
      }

      boards: {
        all: () => Promise<Board[]>
        tracksByColumn: (column: string) => Promise<Track[]>
      }

      settings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<{ ok: boolean; error?: string }>
      }

      fs: {
        // Job-based — see MoveJob/runMoveJob in main/index.ts. Both resolve
        // immediately with a jobId; progress comes over onMoveProgress.
        moveFile: (
          from: string,
          to: string
        ) => Promise<{ ok: boolean; jobId?: string; error?: string }>
        moveFiles: (payload: {
          trackIds: number[]
          destAbsolutePath: string
        }) => Promise<{ jobId: string }>
        cancelMove: (jobId: string) => Promise<{ ok: boolean; error?: string }>
        isCrossDevice: (
          filepaths: string[],
          destPath: string
        ) => Promise<{ ok: boolean; crossDevice?: boolean; totalBytes?: number; error?: string }>
        renameFile: (
          filepath: string,
          newName: string
        ) => Promise<{ ok: boolean; newPath?: string; error?: string }>
        createFolder: (
          parent: string,
          name: string
        ) => Promise<{
          ok: boolean
          path?: string
          folderId?: number | null
          reason?: string
          error?: string
        }>
        readFolder: (
          folderPath: string
        ) => Promise<{ ok: boolean; items?: FolderItem[]; error?: string }>
        // Drag-and-drop from Finder — see fs:classify-paths/fs:copy-into-folder
        // in main/index.ts. classifyPaths never guesses from a filename; the
        // renderer just routes on the returned kind.
        classifyPaths: (paths: string[]) => Promise<{ path: string; kind: 'dir' | 'audio' | 'other' }[]>
        copyIntoFolder: (payload: {
          sourcePaths: string[]
          destAbsolutePath: string
          currentFolderPath: string
          deleteSource?: boolean
        }) => Promise<{ jobId: string }>
        cancelCopy: (jobId: string) => Promise<{ ok: boolean; error?: string }>
      }

      onFoldersChanged: (cb: () => void) => void
      offFoldersChanged: () => void

      onCopyProgress: (cb: (p: CopyProgressPayload) => void) => void
      offCopyProgress: () => void

      // Modern Electron removed File.path — resolves a dropped File's real
      // path via the preload's webUtils.getPathForFile bridge. Never read
      // file.path in the renderer; it's undefined.
      getPathForFile: (file: File) => string

      artwork: {
        pathFor: (hash: string | null, size: 'full' | 'thumb') => Promise<string | null>
        sweepOrphaned: () => Promise<{ removed: number; bytesReclaimed: number }>
      }
    }
  }

  // ─── Shared types ─────────────────────────────────────────

  interface Track {
    id: number
    filepath: string
    filename: string | null
    title: string | null
    artist: string | null
    album: string | null
    genre: string | null
    year: string | null
    remixer: string | null
    composer: string | null
    comment: string | null
    label: string | null
    grouping: string | null
    bpm: number | null
    key_camelot: string | null
    key_full: string | null
    camelot: string | null
    openkey: string | null
    duration_sec: number | null
    duration_str: string | null
    file_size_mb: number | null
    format: string | null
    waveform: string | null
    artwork_path: string | null
    artwork_hash: string | null
    board_id: number
    board_name?: string // joined from boards table
    board_color?: string // joined from boards table
    energy: number | null
    analyzed_at: string | null
    added_at: string
    updated_at: string
    last_modified: number | null
    missing: number
    needs_sync: number
    pending_changes: string | null
    last_seen_at: string | null
    folder_id: number | null
  }

  interface FolderRow {
    id: number
    name: string
    path: string | null
    parent_folder_id: number | null
    root_folder_id: number | null
    relative_path: string | null
    created_at: number
    updated_at: number | null
  }

  interface Tag {
    id: number
    field: string
    value: string
    color: string
    created_at: number
    track_count?: number
  }

  interface TagCandidate {
    value: string
    exists: boolean
    trackCount: number
  }

  interface PendingImport {
    id: number
    track_id: number
    raw_comment: string
    candidates: string[]
    created_at: number
  }

  interface Crate {
    id: number
    name: string
    color: string
    created_at: number
    track_count?: number
  }

  interface Board {
    id: number
    name: string
    color: string
    position: number
    created_at: number
  }

  interface AnalysisResult {
    success: boolean
    error?: string
    filepath: string
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
    key_full: string | null
    key_camelot: string | null
    camelot: string | null
    duration_sec: number | null
    duration_str: string | null
    bpm_tag: string | null
    artwork_base64: string | null
    analyzed: boolean
  }

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

  interface FolderItem {
    name: string
    path: string
    isDirectory: boolean
    size: number
    modified: number
    audioCount: number
  }

  // TODO: independently redefined here, in main/index.ts, and in
  // preload/index.ts — see the same TODO on JobState in useLibraryStore.ts.
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

  // TODO: independently redefined here, in main/index.ts, and in
  // preload/index.ts — see the same TODO on JobState in useLibraryStore.ts.
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

  interface LibraryRoot {
    id: number
    name: string
    path: string
    created_at: number
    last_scanned_at: number | null
    status: string
  }

  interface PendingChange {
    id: number
    root_id: number
    change_type: 'added' | 'moved' | 'renamed' | 'deleted'
    old_path: string | null
    new_path: string | null
    track_id: number | null
    title: string | null
    artist: string | null
    artwork_hash: string | null
    detected_at: number
    status: 'pending' | 'accepted' | 'ignored'
  }
}
