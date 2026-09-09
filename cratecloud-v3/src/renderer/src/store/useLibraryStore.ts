import { create } from 'zustand'

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

  // ── Actions ──────────────────────────────────────────
  // Actions are functions that change the state
  // Components call these instead of setState directly

  setSidebarCollapsed: (collapsed: boolean) => void
  setDisplayMode: (mode: 'list' | 'grid') => void
  setTracks: (tracks: Track[]) => void
  addTrack: (track: Track) => void
  setBoards: (boards: Board[]) => void
  updateTrack: (id: number, changes: Partial<Track>) => void
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
