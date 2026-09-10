import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
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
import { PlayerBar } from './components/PlayerBar'

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
    removeJob,
    mergeTracks,
    setPendingFolderNav
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

  // A drop that misses every drop target should do nothing — without this,
  // Electron's default behavior navigates the whole window to the dropped
  // file. A real target's own preventDefault doesn't stop this from also
  // firing (drag events still bubble), but by then it's a harmless no-op —
  // this listener never calls into any import logic itself.
  useEffect(() => {
    function preventDefault(e: DragEvent): void {
      e.preventDefault()
    }
    window.addEventListener('dragover', preventDefault)
    window.addEventListener('drop', preventDefault)
    return () => {
      window.removeEventListener('dragover', preventDefault)
      window.removeEventListener('drop', preventDefault)
    }
  }, [])

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
        // Long enough for the new "Open folder" action to actually be
        // clickable — 1.5s (the old delay) barely gave time to notice the
        // row before it vanished.
        setTimeout(() => removeJob(p.jobId), 6000)
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

    // Move job progress — trackIds isn't part of the wire payload (it never
    // changes mid-job, so there's no point re-sending it every tick); the
    // dispatcher (MoveFileButton/BulkBar) seeds it into the store when the
    // job is created, and this just carries it forward on every update.
    window.api.onMoveProgress((p) => {
      const existing = useLibraryStore.getState().jobs[p.jobId]
      const trackIds = existing && existing.type === 'move' ? existing.trackIds : []
      upsertJob({ ...p, type: 'move', trackIds })

      if (p.phase === 'done' || p.phase === 'cancelled') {
        if (p.phase === 'done') {
          const failedCount = p.failed.length
          const succeededCount = p.done - failedCount
          if (failedCount > 0) {
            toast.error(`${succeededCount} moved, ${failedCount} failed`, {
              description: p.failed
                .map((f) => `${f.filepath.split('/').pop()}: ${f.error}`)
                .join('\n')
              // TODO: retry failed — surface a "Retry" action here once that
              // flow exists; out of scope for this task.
            })
          } else {
            toast.success(`${succeededCount} moved`)
          }
        }

        if (trackIds.length > 0) {
          window.api.db.tracksByIds(trackIds).then(mergeTracks)
        }
        setTimeout(() => removeJob(p.jobId), 1500)
      }
    })

    // Copy job progress (drag-and-drop into a specific folder) — the copy
    // job holds its 'done'/'cancelled' event until the import step that
    // follows (importSingleFile or a folder re-scan) also finishes, so
    // it's safe to refetch tracks right here once either fires.
    window.api.onCopyProgress((p) => {
      upsertJob({ ...p, type: 'copy' })

      if (p.phase === 'done' || p.phase === 'cancelled') {
        if (p.phase === 'done') {
          const failedCount = p.failed.length
          const succeededCount = p.done - failedCount
          const verbed = p.deleteSource ? 'moved' : 'copied'
          if (failedCount > 0) {
            toast.error(`${succeededCount} ${verbed}, ${failedCount} failed`, {
              description: p.failed
                .map((f) => `${f.sourcePath.split('/').pop()}: ${f.error}`)
                .join('\n')
            })
          } else if (succeededCount > 0) {
            toast.success(
              p.deleteSource
                ? `${succeededCount} file${succeededCount !== 1 ? 's' : ''} moved`
                : `${succeededCount} file${succeededCount !== 1 ? 's' : ''} added`
            )
          }
        }
        window.api.db.allTracks().then(setTracks)
        setTimeout(() => removeJob(p.jobId), 1500)
      }
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
      // offMoveProgress was missing here before — a pre-existing gap this
      // touches the same block for, not something new to this task.
      window.api.offMoveProgress()
      window.api.offCopyProgress()
      if (batchRefreshTimer.current) clearTimeout(batchRefreshTimer.current)
      if (foldersRefreshTimer.current) clearTimeout(foldersRefreshTimer.current)
    }
  }, [setTracks, updateTrack, upsertJob, removeJob, setFolderData, mergeTracks])

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
      // A brand-new root may have just been registered (library:import-folder
      // does that server-side) — without this, libraryRoots stays stale for
      // the rest of the session and the Folders view shows "No library
      // folders registered" even though the DB row and watcher are both
      // already correct, until the app is relaunched.
      await reloadRoots()

      toast.success(`Imported ${result.imported ?? 0} track${result.imported !== 1 ? 's' : ''}`, {
        action: { label: 'Open folder', onClick: () => void navigateToFolderPath(folderPath) }
      })
    } else if (result.error) {
      toast.error(result.error)
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

  async function handleCancelMove(jobId: string): Promise<void> {
    await window.api.fs.cancelMove(jobId)
  }

  async function handleCancelCopy(jobId: string): Promise<void> {
    await window.api.fs.cancelCopy(jobId)
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

  // Drag-and-drop from Finder onto EmptyView — same import handlers the
  // dialogs call (importFolder/importFile), just routed by fs:classify-paths
  // instead of a dialog selection. Folders each become their own sequential
  // import (and get registered as a root, exactly like handleImport's
  // dialog flow, since library:import-folder does both); audio files import
  // individually, matching handleImportFiles.
  async function handleImportPaths(paths: string[]): Promise<void> {
    const classified = await window.api.fs.classifyPaths(paths)
    const dirs = classified.filter((c) => c.kind === 'dir').map((c) => c.path)
    const audioFiles = classified.filter((c) => c.kind === 'audio').map((c) => c.path)
    const skipped = classified.filter((c) => c.kind === 'other').map((c) => c.path)

    setAnalyzing(true)
    for (const dir of dirs) {
      const result = await window.api.importFolder(dir)
      if (!result.ok && result.error) {
        toast.error(result.error)
      } else if (result.ok) {
        toast.success(`Imported ${result.imported ?? 0} track${result.imported !== 1 ? 's' : ''}`, {
          action: { label: 'Open folder', onClick: () => void navigateToFolderPath(dir) }
        })
      }
    }
    for (const filepath of audioFiles) {
      await window.api.importFile(filepath)
    }
    const all = await window.api.db.allTracks()
    setTracks(all)
    // Same staleness gap as handleImport — a dropped folder can register a
    // brand-new root, and libraryRoots only otherwise refreshes at launch.
    if (dirs.length > 0) await reloadRoots()
    setAnalyzing(false)

    if (skipped.length > 0) {
      toast.warning(
        `Skipped ${skipped.length} unsupported file${skipped.length !== 1 ? 's' : ''}`,
        { description: skipped.map((p) => p.split('/').pop()).join(', ') }
      )
    }
  }

  // ── Roots reload ──────────────────────────────────────
  async function reloadRoots(): Promise<void> {
    const roots = await window.api.roots.all()
    setLibraryRoots(roots)
  }

  // Shared by the import-completion toast action and BackgroundJobsPanel's
  // "Open folder" button. Resolves fresh via IPC rather than the store's
  // debounced `folders` snapshot — this only runs on a click, well after
  // the folders:changed debounce would have settled, but a fresh lookup
  // costs nothing and removes that race entirely. The actual navigation
  // still only ever happens inside FolderView (via its own navStack) —
  // this just switches tabs and leaves the folder id for FolderView's
  // pendingFolderNav effect to pick up.
  async function navigateToFolderPath(folderPath: string): Promise<void> {
    const tree = await window.api.folders.tree()
    const folder = tree.find((f) => f.path === folderPath)
    if (!folder) return
    setActiveView('folders')
    setPendingFolderNav(folder.id)
  }

  // ── View change ───────────────────────────────────────
  function handleViewChange(view: View): void {
    setActiveView(view)
  }

  return (
    <div
      style={{
        padding: '1rem',
        fontFamily: 'monospace',
        color: '#e8e8f0',
        background: '#0e0e12',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* <h2 style={{ marginBottom: '0.5rem' }}>CrateCloud v2</h2> */}

      {/* Hidden track count — for Playwright tests */}
      <div data-testid="track-count" style={{ display: 'none' }}>
        {tracks.length} track{tracks.length !== 1 ? 's' : ''} in library
      </div>

      {/* Toolbar at the top */}
      <Toolbar onImport={handleImport} activeView={activeView} onImportFiles={handleImportFiles} />

      {/* Background jobs (import, move, copy) — non-modal, stays visible across navigation */}
      <BackgroundJobsPanel
        onCancelImport={handleCancelImport}
        onResumeImport={handleResumeImport}
        onCancelMove={handleCancelMove}
        onCancelCopy={handleCancelCopy}
        onOpenFolder={(folderPath) => void navigateToFolderPath(folderPath)}
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
            (tracks.length === 0 ? (
              <EmptyState onImport={handleImport} onImportPaths={handleImportPaths} />
            ) : (
              <DashboardView />
            ))}
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

      <PlayerBar />

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
