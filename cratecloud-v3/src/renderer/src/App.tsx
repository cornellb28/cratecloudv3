import React, { useEffect, useState } from 'react'
import { useLibraryStore } from './store/useLibraryStore'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { LibraryView } from './components/LibraryView'
import { BoardView } from './components/BoardView'
import { Inspector } from './components/Inpector'
import { FolderView } from './views/FolderView'
import { SettingsModal } from './components/SettingsModal'
import { EmptyState } from './views/EmptyState'
import { DashboardView } from '@renderer/views/DashboardView'
import type { View } from './components/Sidebar'

// type View = 'dashboard' | 'library' | 'board' | 'genre' | 'artist' | 'folders' | 'crates' | 'settings'

const COLLAPSE_THRESHOLD = 900 // px

function App(): React.JSX.Element {
  const {
    tracks,
    setTracks,
    setAnalyzing,
    activeTrackId,
    setBoards,
    updateTrack,
    sidebarCollapsed,
    setSidebarCollapsed,
    setTags,
    setQuickTags
  } = useLibraryStore()
  const [activeView, setActiveView] = useState<View>('dashboard')
  // Add library roots to app state
  const [libraryRoots, setLibraryRoots] = useState<LibraryRoot[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [progress, setProgress] = useState<{
    done: number
    total: number
    filepath: string
  } | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<{
    done: number
    total: number
  } | null>(null)

  // ── Auto-collapse on narrow window ────────────────────
  useEffect(() => {
    function handleResize(): void {
      if (window.innerWidth < COLLAPSE_THRESHOLD) {
        setSidebarCollapsed(true)
      }
    }

    window.addEventListener('resize', handleResize)
    handleResize() // check on mount
    return () => window.removeEventListener('resize', handleResize)
  }, [setSidebarCollapsed])

  // Load existing tracks from SQLite on startup
  // ── Load data on startup ──────────────────────────────
  useEffect(() => {
    async function load(): Promise<void> {
      const [tracks, boards, tags, quickTags, roots] = await Promise.all([
        window.api.db.allTracks(),
        window.api.boards.all(),
        window.api.tags.all(),
        window.api.tags.mostUsed(),
        window.api.roots.all()
      ])
      setTracks(tracks)
      setBoards(boards)
      setTags(tags)
      setQuickTags(quickTags)
      setLibraryRoots(roots)
    }
    load()
  })

  // Listen for progress events from the import handler
  // ── Import progress listeners ─────────────────────────
  useEffect(() => {
    window.api.onImportProgress((p) => {
      setProgress(p)

      // Reload the store after each track is saved
      // so it appears in the list immediately
      window.api.db.allTracks().then(setTracks)
    })

    // Phase 2 — update individual tracks as BPM/key comes in
    window.api.onTrackAnalyzed((data) => {
      updateTrack(data.trackId, {
        bpm: data.bpm,
        key_camelot: data.key_camelot,
        key_full: data.key_full,
        duration_sec: data.duration_sec,
        duration_str: data.duration_str
      })
      setAnalysisProgress({
        done: data.done,
        total: data.total
      })
    })

    window.api.onAnalysisComplete(() => {
      setAnalysisProgress(null)
    })

    return () => {
      window.api.offAnalysisListeners()
      window.api.offImportProgress()
    }
  }, [setTracks])

  // ── Import handlers ───────────────────────────────────
  async function handleImportFolder(): Promise<void> {
    const folderPath = await window.api.openFolder()
    if (!folderPath) return

    setAnalyzing(true)
    setProgress({ done: 0, total: 0, filepath: '' })

    const result = await window.api.importFolder(folderPath)

    if (result.ok) {
      // Final reload to make sure everything is in sync
      const all = await window.api.db.allTracks()
      setTracks(all)
    }

    // Clear progress after 2 seconds
    setAnalyzing(false)
    setTimeout(() => setProgress(null), 2000)
  }

  // Add import files handler
  async function handleImportFiles(): Promise<void> {
    const filepaths = await window.api.openFiles()
    if (!filepaths.length) return

    for (const filepath of filepaths) {
      await window.api.importFile(filepath)
      window.api.db.allTracks().then(setTracks)
    }
  }

  // ── Roots reload ──────────────────────────────────────
  async function reloadRoots(): Promise<void> {
    const roots = await window.api.roots.all()
    setLibraryRoots(roots)
  }

  // ── View change ───────────────────────────────────────
  function handleViewChange(view: View): void {
    setActiveView(view)
  }

  // ── Progress percentage ───────────────────────────────
  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div
      style={{
        padding: '2rem',
        fontFamily: 'monospace',
        color: '#e8e8f0',
        background: '#0e0e12',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <h2 style={{ marginBottom: '0.5rem' }}>CrateCloud v2</h2>
      <p data-testid="track-count" style={{ color: '#555', marginBottom: '1rem' }}>
        {tracks.length} track{tracks.length !== 1 ? 's' : ''} in library
      </p>

      {/* Toolbar at the top */}
      <Toolbar
        onImport={handleImportFolder}
        activeView={activeView}
        onImportFiles={handleImportFiles}
      />

      {analysisProgress && (
        <div
          style={{
            padding: '4px 16px',
            background: '#13131b',
            borderBottom: '0.5px solid #1e1e2a'
          }}
        >
          <div className="text-xs text-muted-foreground mb-1">
            Analyzing BPM + key — {analysisProgress.done} / {analysisProgress.total}
          </div>
          <div
            style={{
              background: '#1e1e2a',
              borderRadius: '4px',
              height: '3px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                background: '#1d9e75',
                height: '100%',
                width: `${Math.round((analysisProgress.done / analysisProgress.total) * 100)}%`,
                transition: 'width 0.3s ease',
                borderRadius: '4px'
              }}
            />
          </div>
        </div>
      )}

      {/* Progress bar */}
      {progress && progress.total > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ color: '#7f77dd', marginBottom: '4px', fontSize: '12px' }}>
            {progress.done} / {progress.total} — {progress.filepath}
          </div>
          <div
            style={{
              background: '#1e1e2a',
              borderRadius: '4px',
              height: '6px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                background: '#7f77dd',
                height: '100%',
                width: `${pct}%`,
                transition: 'width 0.2s ease',
                borderRadius: '4px'
              }}
            />
          </div>
        </div>
      )}

      {/* Main area — sidebar + content side by side */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          activeView={activeView}
          onViewChange={handleViewChange}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeView === 'dashboard' && (tracks.length === 0 ? <EmptyState onImport={handleImportFolder} /> : <DashboardView />)}
          {activeView === 'library' && <LibraryView />}
          {activeView === 'board' && (
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', color: '#333' }}>
              <BoardView />
            </div>
          )}
          {activeView === 'folders' &&
            (libraryRoots.length > 0 ? (
              <FolderView libraryRoots={libraryRoots} />
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  color: '#333'
                }}
              >
                <span style={{ fontSize: '48px' }}>⊟</span>
                <div style={{ fontSize: '14px' }}>No library folders registered</div>
                <button
                  onClick={() => setSettingsOpen(true)}
                  style={{
                    fontSize: '12px',
                    color: '#7f77dd',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Open Settings to add a music folder
                </button>
              </div>
            ))}

          {activeView === 'genre' && (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#333',
              fontSize: '14px',
            }}>
              Genre view — coming soon
            </div>
          )}

          {activeView === 'artist' && (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#333',
              fontSize: '14px',
            }}>
              Artist view — coming soon
            </div>
          )}

          {activeView === 'crates' && (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#333',
              fontSize: '14px',
            }}>
              Crates — coming soon
            </div>
          )}
        </div>

        {/* Inspector slides in from the right when a track is selected */}
        <Inspector key={activeTrackId ?? 'none'} />
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        libraryRoots={libraryRoots}
        onRootsChanged={reloadRoots}
      />
    </div>
  )
}

export default App
