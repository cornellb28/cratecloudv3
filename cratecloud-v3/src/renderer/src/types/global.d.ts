export { }

declare global {
  interface Window {
    api: {
      getArtworkUrl: (filepath: string) => string
      openFolder: () => Promise<string | null>
      openFiles: () => Promise<string[]>
      importFile: (filepath: string) => Promise<{ ok: boolean; trackId?: number; error?: string }>
      importFiles: (filepaths: string[]) => Promise<{ ok: boolean; count: number; results: { ok: boolean; trackId?: number; error?: string }[] }>
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

      onImportProgress: (cb: (p: {
        done: number
        total: number
        failed: number
        filepath: string
      }) => void) => void

      offImportProgress: () => void

      onTrackAnalyzed: (cb: (data: {
        trackId: number
        bpm: number | null
        key_camelot: string | null
        key_full: string | null
        duration_sec: number | null
        duration_str: string | null
        done: number
        total: number
      }) => void) => void

      onPhase1Complete: (cb: (data: { imported: number; total: number }) => void) => void

      onAnalysisComplete: (cb: (data: { analyzed: number; total: number }) => void) => void

      offAnalysisListeners: () => void

      db: {
        allTracks: () => Promise<Track[]>
        trackById: (id: number) => Promise<Track | null>
        insertTrack: (track: Partial<Track>) => Promise<{ ok: boolean; id?: number; error?: string }>
        updateTrackMeta: (data: Partial<Track> & { id: number }) => Promise<{ ok: boolean; error?: string }>
        updateBoardId: (id: number, boardId: number) => Promise<{ ok: boolean; error?: string }>
        tracksByBoardId: (id: number, boardId: number) => Promise<Track[]>
        markMissing: (filepath: string) => Promise<{ ok: boolean; error?: string }>
      }

      tags: {
        all: () => Promise<Tag[]>
        forTrack: (trackId: number) => Promise<Tag[]>
        tracksByTag: (tagId: number) => Promise<Track[]>
        apply: (trackId: number, tagId: number) => Promise<{ ok: boolean; error?: string }>
        remove: (trackId: number, tagId: number) => Promise<{ ok: boolean; error?: string }>
        checkCandidates: (candidates: string[], field: string) => Promise<TagCandidate[]>
        confirmImport: (pendingId: number, trackId: number, approvedTags: string[], field: string) => Promise<{ ok: boolean; error?: string }>
        pending: () => Promise<PendingImport[]>
      }

      crates: {
        all: () => Promise<Crate[]>
        insert: (name: string, color: string) => Promise<{ ok: boolean; id?: number; error?: string }>
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
}
