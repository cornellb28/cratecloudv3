import React, { useEffect, useRef, useState } from 'react'
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
import { Breadcrumb } from './components/Breadcrumb'
import { ReconciliationModal } from './components/ReconciliationModal'
import { Toaster } from './components/ui/sonner'
import { BackgroundJobsPanel } from './components/BackgroundJobsPanel'

// type View = 'dashboard' | 'library' | 'board' | 'genre' | 'artist' | 'folders' | 'crates' | 'settings'

const COLLAPSE_THRESHOLD = 900 // px
const FOLDERS_REFETCH_DEBOUNCE_MS = 300

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
    setQuickTags,
    setAllTrackTags,
    setFolderData,
    upsertJob,
    removeJob
  } = useLibraryStore()
  const [activeView, setActiveView] = useState<View>('dashboard')
  // Add library roots to app state
  const [libraryRoots, setLibraryRoots] = useState<LibraryRoot[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  // Batch-committed events fire once per ~200-row transaction — debounce the
  // resulting track-list refetch so a burst of fast batches collapses into one.
  const batchRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // folders:changed can fire many times during one import (once per
  // ensureFolderTree call) — debounce so a large import doesn't hammer
  // folders:tree/tracks:folder-counts with a refetch per directory.
  const foldersRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // ── Watchers ────────────────────
  useEffect(() => {
    // New file added by Finder - add to store
    window.api.onTrackAdded(async () => {
      const all = await window.api.db.allTracks()
      setTracks(all)
    })

    // File moved — folder_id changes with the path (it mirrors disk
    // location), so refetch rather than patch just filepath in place.
    window.api.onTrackMoved(async () => {
      const all = await window.api.db.allTracks()
      setTracks(all)
    })

    // File deleted — reload store
    window.api.onTrackDeleted(async () => {
      const all = await window.api.db.allTracks()
      setTracks(all)
    })

    window.api.onRootOnline(() => {
      setReconcileOpen(true)
    })

    // Root went offline
    window.api.onRootOffline(({ rootPath }) => {
      console.log('Root offline:', rootPath)
      // Show notification — we will add this UI next
    })

    return () => window.api.offWatcherListeners()
  })

  // Load existing tracks from SQLite on startup
  // ── Load data on startup ──────────────────────────────
  useEffect(() => {
    async function load(): Promise<void> {
      const [tracks, boards, tags, quickTags, roots, folderTree, folderCounts] = await Promise.all([
        window.api.db.allTracks(),
        window.api.boards.all(),
        window.api.tags.all(),
        window.api.tags.mostUsed(),
        window.api.roots.all(),
        window.api.folders.tree(),
        window.api.db.folderTrackCounts()
      ])
      setTracks(tracks)
      setBoards(boards)
      setTags(tags)
      setQuickTags(quickTags)
      setLibraryRoots(roots)
      // Initial snapshot — folders:changed (subscribed below) keeps it fresh
      // from here on, but that event only fires on a subsequent change, so
      // a library that's already fully imported needs this or the slice
      // would stay empty until the next folder gets created.
      setFolderData(folderTree, folderCounts)

      // Hydrate trackTags for every track up front — one bulk query instead
      // of one tags.forTrack round trip per track — so badges show without
      // clicking a row first.
      const tagsByTrack = await window.api.tags.forTracks(tracks.map((t) => t.id))
      setAllTrackTags(tagsByTrack)
    }
    load()
  }, [])

  // Listen for progress events from the import handler
  // ── Import progress listeners ─────────────────────────
  useEffect(() => {
    window.api.onImportProgress((p) => {
      upsertJob({ ...p, type: 'import' })

      if (p.phase === 'done') {
        setTimeout(() => removeJob(p.jobId), 1500)
      }
    })

    // A ~200-row batch just committed — debounce the refetch so a burst of
    // fast batches (small files, warm cache) collapses into one reload
    // instead of hammering the store on every commit.
    window.api.onImportBatchCommitted(() => {
      if (batchRefreshTimer.current) clearTimeout(batchRefreshTimer.current)
      batchRefreshTimer.current = setTimeout(() => {
        window.api.db.allTracks().then(setTracks)
      }, 500)
    })

    // A folders row was inserted somewhere (import, watcher, create-folder,
    // move) — debounced since one import can trigger this many times over
    // (once per ensureFolderTree call), and FolderView reads this slice
    // instead of fetching its own copy.
    window.api.onFoldersChanged(() => {
      if (foldersRefreshTimer.current) clearTimeout(foldersRefreshTimer.current)
      foldersRefreshTimer.current = setTimeout(async () => {
        const [tree, counts] = await Promise.all([
          window.api.folders.tree(),
          window.api.db.folderTrackCounts()
        ])
        setFolderData(tree, counts)
      }, FOLDERS_REFETCH_DEBOUNCE_MS)
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

    // Phase 2 complete — hide the analysis bar
    window.api.onAnalysisComplete(() => {
      setTimeout(() => setAnalysisProgress(null), 3000)
    })

    return () => {
      window.api.offAnalysisListeners()
      window.api.offImportProgress()
      window.api.offFoldersChanged()
      if (batchRefreshTimer.current) clearTimeout(batchRefreshTimer.current)
      if (foldersRefreshTimer.current) clearTimeout(foldersRefreshTimer.current)
    }
  }, [setTracks, updateTrack, upsertJob, removeJob, setFolderData])

  // ── Import handlers ───────────────────────────────────
  async function handleImport(): Promise<void> {
    const folderPath = await window.api.openFolder()
    if (!folderPath) return

    setAnalyzing(true)

    const result = await window.api.importFolder(folderPath)

    if (result.ok) {
      // Final reload to make sure everything is in sync
      const all = await window.api.db.allTracks()
      setTracks(all)
    }

    setAnalyzing(false)
    // Progress bar is cleared by the 'done' phase of onImportProgress
  }

  async function handleCancelImport(jobId: string): Promise<void> {
    await window.api.cancelImport(jobId)
  }

  async function handleResumeImport(jobId: string): Promise<void> {
    setAnalyzing(true)
    const result = await window.api.resumeImport(jobId)
    if (result.ok) {
      const all = await window.api.db.allTracks()
      setTracks(all)
    }
    setAnalyzing(false)
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

      {/* Hidden track count — for Playwright tests */}
      <div data-testid="track-count" style={{ display: 'none' }}>
        {tracks.length} track{tracks.length !== 1 ? 's' : ''} in library
      </div>

      {/* Toolbar at the top */}
      <Toolbar onImport={handleImport} activeView={activeView} onImportFiles={handleImportFiles} />

      {/* Background jobs (import today; move once added) — non-modal, stays visible across navigation */}
      <BackgroundJobsPanel
        onCancelImport={handleCancelImport}
        onResumeImport={handleResumeImport}
      />

      {/* Phase 2 — analysis progress bar */}
      {analysisProgress !== null && analysisProgress.total > 0 && (
        <div
          style={{
            padding: '4px 16px',
            background: '#13131b',
            borderBottom: '0.5px solid #1e1e2a',
            flexShrink: 0
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
          {/* App-level breadcrumb */}
          <Breadcrumb activeView={activeView} onNavigate={setActiveView} />
          {/* Views */}
          {activeView === 'dashboard' &&
            (tracks.length === 0 ? <EmptyState onImport={handleImport} /> : <DashboardView />)}
          {activeView === 'library' && <LibraryView />}
          {activeView === 'board' && <BoardView />}
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
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#333',
                fontSize: '14px'
              }}
            >
              Genre view — coming soon
            </div>
          )}

          {activeView === 'artist' && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#333',
                fontSize: '14px'
              }}
            >
              Artist view — coming soon
            </div>
          )}

          {activeView === 'crates' && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#333',
                fontSize: '14px'
              }}
            >
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
      <ReconciliationModal open={reconcileOpen} onClose={() => setReconcileOpen(false)} />
      <Toaster />
    </div>
  )
}

export default App
