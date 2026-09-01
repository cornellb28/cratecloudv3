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

  // ── Actions ──────────────────────────────────────────
  // Actions are functions that change the state
  // Components call these instead of setState directly

  setTracks: (tracks: Track[]) => void
  addTrack: (track: Track) => void
  setBoards: (boards: Board[]) => void
  updateTrack: (id: number, changes: Partial<Track>) => void
  removeTrack: (id: number) => void
  setActiveTrack: (id: number | null) => void
  setAnalyzing: (value: boolean) => void
  setSearchQuery: (query: string) => void
}

// ─── Store ───────────────────────────────────────────────

export const useLibraryStore = create<LibraryState>((set) => ({
  // Initial state — empty until data loads from SQLite
  tracks: [],
  activeTrackId: null,
  isAnalyzing: false,
  boards: [],
  searchQuery: '',

  // Replace the entire track list
  // Called on app startup when we load from SQLite
  setTracks: (tracks) => set({ tracks }),

  // Add one track to the front of the list
  // Called after a file is analyzed
  addTrack: (track) => set((state) => ({
    tracks: [track, ...state.tracks]
  })),

  // Update one track by id without replacing the whole list
  // Called after editing metadata in the Inspector
  updateTrack: (id, changes) => set((state) => ({
    tracks: state.tracks.map((t) =>
      t.id === id ? { ...t, ...changes } : t
    )
  })),

  // Remove one track by id
  removeTrack: (id) => set((state) => ({
    tracks: state.tracks.filter((t) => t.id !== id)
  })),

  // Set the active track for the Inspector panel
  setActiveTrack: (id) => set({ activeTrackId: id }),

  // Toggle the analyzing state for the progress indicator
  setAnalyzing: (value) => set({ isAnalyzing: value }),
  setBoards: (boards) => set({ boards }),
  setSearchQuery: (query)  => set({ searchQuery: query }),
}))
