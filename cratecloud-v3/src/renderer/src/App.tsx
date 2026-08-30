import React, { useEffect, useState } from 'react'
import { useLibraryStore } from './store/useLibraryStore'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { LibraryView } from './components/LibraryView'
import { Inspector } from './components/Inpector'

type View = 'library' | 'board'

function App(): React.JSX.Element {
  const { tracks, setTracks, setAnalyzing } = useLibraryStore()
  const [activeView, setActiveView] = useState<View>('library')
  const [progress, setProgress] = useState<{
    done: number
    total: number
    filepath: string
  } | null>(null)

  // Load existing tracks from SQLite on startup
  useEffect(() => {
    async function loadTracks(): Promise<void> {
      const all = await window.api.db.allTracks()
      setTracks(all)
    }
    loadTracks()
  }, [setTracks])

  // Listen for progress events from the import handler
  useEffect(() => {
    window.api.onImportProgress((p) => {
      setProgress(p)

      // Reload the store after each track is saved
      // so it appears in the list immediately
      window.api.db.allTracks().then(setTracks)
    })

    return () => {
      window.api.offImportProgress()
    }
  }, [setTracks])

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

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', color: '#e8e8f0', background: '#0e0e12', minHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <h2 style={{ marginBottom: '0.5rem' }}>CrateCloud v2</h2>
      <p style={{ color: '#555', marginBottom: '1rem' }}>
        {tracks.length} track{tracks.length !== 1 ? 's' : ''} in library
      </p>

      {/* Toolbar at the top */}
      <Toolbar onImport={handleImportFolder} />

      {/* Progress bar */}
      {progress && progress.total > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ color: '#7f77dd', marginBottom: '4px', fontSize: '12px' }}>
            {progress.done} / {progress.total} — {progress.filepath}
          </div>
          <div style={{ background: '#1e1e2a', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
            <div style={{
              background: '#7f77dd',
              height: '100%',
              width: `${pct}%`,
              transition: 'width 0.2s ease',
              borderRadius: '4px',
            }} />
          </div>
        </div>
      )}

      {/* Main area — sidebar + content side by side */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        <Sidebar
          activeView={activeView}
          onViewChange={setActiveView}
        />

        {/* Content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeView === 'library' && <LibraryView />}
          {activeView === 'board' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
              Board view — coming next
            </div>
          )}
        </div>

        {/* Inspector slides in from the right when a track is selected */}
        <Inspector />

      </div>
    </div>
  )
}

export default App
