export {}

declare global {
  interface Window {
    api: {
      getArtworkUrl: (filepath: string) => string
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
        message?: string
        error?: string
      }>

      onImportProgress: (
        cb: (p: { done: number; total: number; failed: number; filepath: string }) => void
      ) => void

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

      onPhase1Complete: (cb: (data: { imported: number; total: number, failed: number }) => void) => void

      onAnalysisComplete: (cb: (data: { analyzed: number; total: number }) => void) => void

      offAnalysisListeners: () => void

      onTrackAdded: (cb: (data: { trackId: number; filepath: string }) => void) => void
      onTrackMoved: (cb: (data: { trackId: number; oldPath: string; newPath: string }) => void) => void
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
      }

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
        moveFile: (
          from: string,
          to: string
        ) => Promise<{ ok: boolean; newPath?: string; error?: string }>
        moveFiles: (
          from: string[],
          to: string
        ) => Promise<{ ok: boolean; succeeded: number; failed: number; results: FileMoveResult[] }>
        renameFile: (
          filepath: string,
          newName: string
        ) => Promise<{ ok: boolean; newPath?: string; error?: string }>
        createFolder: (
          parent: string,
          name: string
        ) => Promise<{ ok: boolean; path?: string; error?: string }>
        readFolder: (
          folderPath: string
        ) => Promise<{ ok: boolean; items?: FolderItem[]; error?: string }>
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

  interface FolderItem {
    name: string
    path: string
    isDirectory: boolean
    size: number
    modified: number
    audioCount: number
  }

  interface FileMoveResult {
    path: string
    ok: boolean
    newPath?: string
    error?: string
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
    artwork_path: string | null
    detected_at: number
    status: 'pending' | 'accepted' | 'ignored'
  }
}
