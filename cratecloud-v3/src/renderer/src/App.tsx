import React, { useEffect, useState } from 'react'
import { useLibraryStore } from './store/useLibraryStore'

function App(): React.JSX.Element {
  const { tracks, setTracks } = useLibraryStore()

  const [progress, setProgress] = useState<{
    done: number
    total: number
    filepath: string
  } | null>(null)

  // Load existing tracks from SQLite on startup
  useEffect(() => {
    async function load(): Promise<void> {
      const all = await window.api.db.allTracks()
      setTracks(all)
    }
    load()
  })

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
  })

  async function handleImportFolder(): Promise<void> {
    const folderPath = await window.api.openFolder()
    if (!folderPath) return

    setProgress({ done: 0, total: 0, filepath: '' })

    const result = await window.api.importFolder(folderPath)

    if (result.ok) {
      // Final reload to make sure everything is in sync
      const all = await window.api.db.allTracks()
      setTracks(all)
    }

    // Clear progress after 2 seconds
    setTimeout(() => setProgress(null), 2000)
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', color: '#e8e8f0', background: '#0e0e12', minHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <h2 style={{ marginBottom: '0.5rem' }}>CrateCloud v2</h2>
      <p style={{ color: '#555', marginBottom: '1rem' }}>
        {tracks.length} track{tracks.length !== 1 ? 's' : ''} in library
      </p>

      <button
        onClick={handleImportFolder}
        disabled={!!progress}
        style={{ padding: '8px 16px', marginBottom: '1rem' }}
      >
        {progress ? 'Importing...' : 'Import folder'}
      </button>

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

      {/* Track list */}
      <div style={{
        height: 'calc(100vh - 180px)',
        overflowY: 'auto',
        paddingRight: '8px',
      }}>
        {tracks.map((track) => (
          <div
            key={track.id}
            style={{
              padding: '8px 12px',
              marginBottom: '4px',
              background: '#1a1a26',
              borderRadius: '6px'
            }}
          >
            <div style={{ fontWeight: 500 }}>
              {track.title ?? track.filename ?? 'Untitled'} — {track.artist ?? 'Unknown'}
            </div>
            <div style={{ color: '#555', fontSize: '12px', marginTop: '2px' }}>
              {track.bpm} BPM · {track.key_camelot} · {track.duration_str}
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}

export default App
