import { create } from 'zustand'

// TODO: ImportProgressPayload/MoveProgressPayload/CopyProgressPayload are
// each independently redefined in main/index.ts, preload/index.ts, and
// global.d.ts (three copies of every shape). JobState below adds a fourth
// de-facto copy via the ambient types. Worth hoisting all job/progress
// payload shapes into one shared types module imported by main, preload,
// and renderer instead of keeping them in sync by hand.
// trackIds isn't part of the wire payload (move:progress never repeats it —
// it can't change mid-job) — the dispatcher (MoveFileButton/BulkBar) seeds
// it in when the job is created; App.tsx's onMoveProgress carries it
// forward on every update after that.
type JobState =
  | (ImportProgressPayload & { type: 'import' })
  | (MoveProgressPayload & { type: 'move'; trackIds: number[] })
  | (CopyProgressPayload & { type: 'copy' })
  | (ExportProgressPayload & { type: 'export' })

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
  // Per-view list/grid mode, keyed by an arbitrary viewKey (see
  // useViewMode) — e.g. 'all_tracks', or 'board:<boardId>' for one of
  // BoardView's columns. Separate from `displayMode` above: that field is
  // FolderView's own single global mode (out of scope for this hook — see
  // useViewMode's comment), left as-is rather than merged in.
  viewModes: Record<string, 'list' | 'grid'>
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

  // Crates — the flat list (nesting is derived from parent_crate_id at
  // render time, not stored as a tree here). crateTrackIds mirrors the
  // crate_tracks join for cheap "is this track already in crate X"
  // lookups (CratePicker), keyed by crateId.
  crates: Crate[]
  crateTrackIds: Map<number, Set<number>>

  // Background jobs (import today, move once added) keyed by jobId — see
  // JobState above for the pending 'move' variant.
  jobs: Record<string, JobState>

  // A cross-component "please navigate FolderView to this folder" signal —
  // navStack itself stays local to FolderView (it's the only thing that
  // ever writes it), this is just the message. Written by App.tsx (an
  // import-completion toast action, or the BackgroundJobsPanel "Open
  // folder" button) after switching activeView to 'folders'; consumed once
  // by an effect in FolderView, which clears it back to null.
  pendingFolderNav: number | null

  // ── Actions ──────────────────────────────────────────
  // Actions are functions that change the state
  // Components call these instead of setState directly

  setSidebarCollapsed: (collapsed: boolean) => void
  setDisplayMode: (mode: 'list' | 'grid') => void
  setViewMode: (key: string, mode: 'list' | 'grid') => void
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
  setPendingFolderNav: (folderId: number | null) => void

  // ── Crates ───────────────────────────────────────────
  setCrates: (crates: Crate[]) => void
  setCrateTrackIds: (byCrate: Record<number, number[]>) => void
  upsertCrateLocally: (crate: Crate) => void
  patchCrateLocally: (id: number, changes: Partial<Crate>) => void
  removeCrateLocally: (id: number) => void
  addTracksToCrateLocally: (crateId: number, trackIds: number[]) => void
  removeTracksFromCrateLocally: (crateId: number, trackIds: number[]) => void
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
  crates: [],
  crateTrackIds: new Map(),
  jobs: {},
  pendingFolderNav: null,
  viewModes: {},

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

  setViewMode: (key, mode) => set((state) => ({ viewModes: { ...state.viewModes, [key]: mode } })),

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
    }),

  // ── Cross-component navigation signal ──────────────────
  setPendingFolderNav: (folderId) => set({ pendingFolderNav: folderId }),

  // ── Crates ─────────────────────────────────────────────
  setCrates: (crates) => set({ crates }),

  setCrateTrackIds: (byCrate) =>
    set({
      crateTrackIds: new Map(
        Object.entries(byCrate).map(([crateId, trackIds]) => [Number(crateId), new Set(trackIds)])
      )
    }),

  upsertCrateLocally: (crate) =>
    set((state) => {
      const exists = state.crates.some((c) => c.id === crate.id)
      return {
        crates: exists
          ? state.crates.map((c) => (c.id === crate.id ? crate : c))
          : [...state.crates, crate]
      }
    }),

  patchCrateLocally: (id, changes) =>
    set((state) => ({
      crates: state.crates.map((c) => (c.id === id ? { ...c, ...changes } : c))
    })),

  removeCrateLocally: (id) =>
    set((state) => {
      // Cascades client-side too — parent_crate_id ON DELETE CASCADE means
      // the server already dropped every descendant crate; mirror that here
      // so a deleted parent's children don't linger in the sidebar until
      // the next full crates:all refetch.
      const dropped = new Set<number>([id])
      let grew = true
      while (grew) {
        grew = false
        for (const c of state.crates) {
          if (c.parent_crate_id !== null && dropped.has(c.parent_crate_id) && !dropped.has(c.id)) {
            dropped.add(c.id)
            grew = true
          }
        }
      }
      const nextTrackIds = new Map(state.crateTrackIds)
      dropped.forEach((cid) => nextTrackIds.delete(cid))
      return {
        crates: state.crates.filter((c) => !dropped.has(c.id)),
        crateTrackIds: nextTrackIds
      }
    }),

  addTracksToCrateLocally: (crateId, trackIds) =>
    set((state) => {
      const next = new Map(state.crateTrackIds)
      const set_ = new Set(next.get(crateId) ?? [])
      trackIds.forEach((id) => set_.add(id))
      next.set(crateId, set_)
      return {
        crateTrackIds: next,
        crates: state.crates.map((c) => (c.id === crateId ? { ...c, track_count: set_.size } : c))
      }
    }),

  removeTracksFromCrateLocally: (crateId, trackIds) =>
    set((state) => {
      const next = new Map(state.crateTrackIds)
      const set_ = new Set(next.get(crateId) ?? [])
      trackIds.forEach((id) => set_.delete(id))
      next.set(crateId, set_)
      return {
        crateTrackIds: next,
        crates: state.crates.map((c) => (c.id === crateId ? { ...c, track_count: set_.size } : c))
      }
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
