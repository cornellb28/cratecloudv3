import { create } from 'zustand'

// TODO: ImportProgressPayload/MoveProgressPayload are each independently
// redefined in main/index.ts, preload/index.ts, and global.d.ts (three
// copies of every shape). JobState below adds a fourth de-facto copy via
// the ambient types. Worth hoisting all job/progress payload shapes into
// one shared types module imported by main, preload, and renderer instead
// of keeping them in sync by hand.
// trackIds isn't part of the wire payload (move:progress never repeats it —
// it can't change mid-job) — the dispatcher (MoveFileButton/BulkBar) seeds
// it in when the job is created; App.tsx's onMoveProgress carries it
// forward on every update after that.
type JobState =
  | (ImportProgressPayload & { type: 'import' })
  | (MoveProgressPayload & { type: 'move'; trackIds: number[] })

// ─── State shape ─────────────────────────────────────────

interface LibraryState {
  // The full track list
  tracks: Track[]
  // Which track the DJ has clicked on
  activeTrackId: number | null
  // Is an analysis currently running
  isAnalyzing: boolean
  boards: Board[]
  searchQuery: string
  sidebarCollapsed: boolean
  displayMode: 'list' | 'grid'
  tags: Tag[]
  quickTags: Tag[]
  trackTags: Map<number, Tag[]>

  // `folders` mirrors the real directory tree (populated at import time);
  // `folderCounts` is one GROUP BY query. Owned here (not per-view local
  // state) so App.tsx's single onFoldersChanged subscription can refresh
  // it once and every consumer (FolderView, FolderTreeDropdown callers,
  // etc.) sees the same data without each mounting its own fetch.
  folders: FolderRow[]
  folderCounts: { folder_id: number; count: number }[]

  // Background jobs (import today, move once added) keyed by jobId — see
  // JobState above for the pending 'move' variant.
  jobs: Record<string, JobState>

  // ── Actions ──────────────────────────────────────────
  // Actions are functions that change the state
  // Components call these instead of setState directly

  setSidebarCollapsed: (collapsed: boolean) => void
  setDisplayMode: (mode: 'list' | 'grid') => void
  setTracks: (tracks: Track[]) => void
  addTrack: (track: Track) => void
  setBoards: (boards: Board[]) => void
  updateTrack: (id: number, changes: Partial<Track>) => void
  // Replaces a set of tracks by id in one pass — used after a move job so
  // only the tracks it actually touched get refetched, instead of allTracks().
  mergeTracks: (updated: Track[]) => void
  removeTrack: (id: number) => void
  setActiveTrack: (id: number | null) => void
  setAnalyzing: (value: boolean) => void
  setSearchQuery: (query: string) => void
  setTags: (tags: Tag[]) => void
  setQuickTags: (tags: Tag[]) => void
  addTag: (tag: Tag) => void
  removeTag: (id: number) => void
  setTrackTags: (trackId: number, tags: Tag[]) => void
  // Bulk version of setTrackTags — one Map build for many tracks instead of
  // one set() per track (each set() rebuilds the whole Map, O(n) per call).
  setAllTrackTags: (tagsByTrack: Record<number, Tag[]>) => void
  setFolderData: (
    folders: FolderRow[],
    folderCounts: { folder_id: number; count: number }[]
  ) => void
  upsertJob: (job: JobState) => void
  removeJob: (jobId: string) => void
}

// ─── Store ───────────────────────────────────────────────

export const useLibraryStore = create<LibraryState>((set) => ({
  // Initial state — empty until data loads from SQLite
  tracks: [],
  activeTrackId: null,
  isAnalyzing: false,
  boards: [],
  searchQuery: '',
  tags: [],
  quickTags: [],
  trackTags: new Map(),
  folders: [],
  folderCounts: [],
  jobs: {},

  sidebarCollapsed: localStorage.getItem('cratecloud_sidebar_collapsed') === 'true',
  displayMode: (localStorage.getItem('cratecloud_display_mode') as 'list' | 'grid') ?? 'list',

  // ── Sidebar ────────────────────────────────────────────

  setSidebarCollapsed: (collapsed) => {
    localStorage.setItem('cratecloud_sidebar_collapsed', String(collapsed))
    set({ sidebarCollapsed: collapsed })
  },
  // ── Display mode ───────────────────────────────────────

  setDisplayMode: (mode) => {
    localStorage.setItem('cratecloud_display_mode', mode)
    set({ displayMode: mode })
  },

  // Replace the entire track list
  // Called on app startup when we load from SQLite
  setTracks: (tracks) => set({ tracks }),

  // Add one track to the front of the list
  // Called after a file is analyzed
  addTrack: (track) =>
    set((state) => ({
      tracks: [track, ...state.tracks]
    })),

  // Update one track by id without replacing the whole list
  // Called after editing metadata in the Inspector
  updateTrack: (id, changes) =>
    set((state) => ({ tracks: state.tracks.map((t) => (t.id === id ? { ...t, ...changes } : t)) })),

  mergeTracks: (updated) =>
    set((state) => {
      const byId = new Map(updated.map((t) => [t.id, t]))
      return { tracks: state.tracks.map((t) => byId.get(t.id) ?? t) }
    }),

  // Remove one track by id
  removeTrack: (id) =>
    set((state) => ({
      tracks: state.tracks.filter((t) => t.id !== id)
    })),

  // Set the active track for the Inspector panel
  setActiveTrack: (id) => set({ activeTrackId: id }),

  // Toggle the analyzing state for the progress indicator
  setAnalyzing: (value) => set({ isAnalyzing: value }),
  // ── Boards ─────────────────────────────────────────────
  setBoards: (boards) => set({ boards }),
  // ── Search ─────────────────────────────────────────────
  setSearchQuery: (query) => set({ searchQuery: query }),

  // ── Tags ───────────────────────────────────────────────

  // All tags in the library — loaded on startup
  setTags: (tags) => set({ tags }),

  // Most used / pinned tags for the quick tag bar
  setQuickTags: (tags) => set({ quickTags: tags }),

  // Add a newly created tag to the library
  addTag: (tag) => set((state) => ({ tags: [...state.tags, tag] })),

  // Remove a tag by id
  removeTag: (id) => set((state) => ({ tags: state.tags.filter((t) => t.id !== id) })),

  // Per-track tag cache — avoids IPC call per row
  // Updated when Inspector opens for a track
  setTrackTags: (trackId, tags) =>
    set((state) => ({
      trackTags: new Map(state.trackTags).set(trackId, tags)
    })),

  setAllTrackTags: (tagsByTrack) =>
    set((state) => {
      const next = new Map(state.trackTags)
      for (const [trackId, tags] of Object.entries(tagsByTrack)) {
        next.set(Number(trackId), tags)
      }
      return { trackTags: next }
    }),

  // ── Folders ────────────────────────────────────────────
  setFolderData: (folders, folderCounts) => set({ folders, folderCounts }),

  // ── Background jobs ────────────────────────────────────
  upsertJob: (job) => set((state) => ({ jobs: { ...state.jobs, [job.jobId]: job } })),
  removeJob: (jobId) =>
    set((state) => {
      const next = { ...state.jobs }
      delete next[jobId]
      return { jobs: next }
    })
}))

// ─── Derived state ────────────────────────────────────────
// Computed from store — not stored directly
// Using separate selectors avoids unnecessary re-renders

export function useFilteredTracks(): Track[] {
  const tracks = useLibraryStore((s) => s.tracks)
  const searchQuery = useLibraryStore((s) => s.searchQuery)

  if (!searchQuery.trim()) return tracks

  const q = searchQuery.toLowerCase()

  return tracks.filter(
    (t) =>
      t.title?.toLowerCase().includes(q) ||
      t.artist?.toLowerCase().includes(q) ||
      t.genre?.toLowerCase().includes(q) ||
      t.key_camelot?.toLowerCase().includes(q) ||
      t.bpm?.toString().includes(q) ||
      t.album?.toLowerCase().includes(q) ||
      t.comment?.toLowerCase().includes(q)
  )
}
