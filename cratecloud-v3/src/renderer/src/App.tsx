import React, { useEffect } from 'react'
import { useLibraryStore } from './store/useLibraryStore'

function App(): React.JSX.Element {
  const {
    tracks,
    isAnalyzing,
    setTracks,
    addTrack,
    setAnalyzing,
  } = useLibraryStore()

  // Load all tracks from SQLite when the app starts
  // useEffect with [] runs once — on first mount only
  useEffect(() => {
    async function loadTracks(): Promise<void> {
      const all = await window.api.db.allTracks()
      setTracks(all)
    }
    loadTracks()
  }, [])

  // Analyze a file and save the result to SQLite + store
  async function handleAnalyzeFile(): Promise<void> {
    const filepath = '/Volumes/MUSICLITE/Iceman-400/Janice STFU Drake.m4a'

    setAnalyzing(true)

    const response = await window.api.analyzeFile(filepath)

    if (!response.ok || !response.data) {
      console.error('Analysis failed:', response.error)
      setAnalyzing(false)
      return
    }

    const data = response.data

    if (!data.success) {
      console.error('Analysis failed:', data.error)
      setAnalyzing(false)
      return
    }

    // Save to SQLite
    const insert = await window.api.db.insertTrack({
      filepath: data.filepath,
      title: data.title,
      artist: data.artist,
      album: data.album,
      genre: data.genre,
      year: data.year,
      comment: data.comment,
      label: data.label,
      remixer: data.remixer,
      composer: data.composer,
      grouping: data.grouping,
      bpm: data.bpm,
      key_camelot: data.key_camelot,
      key_full: data.key_full,
      camelot: data.camelot,
      duration_sec: data.duration_sec,
      duration_str: data.duration_str,
      analyzed_at: new Date().toISOString(),
    })

    if (!insert.ok) {
      console.error('Insert failed:', insert.error)
      setAnalyzing(false)
      return
    }

    // Add to the store so the UI updates immediately
    // without needing to re-fetch from SQLite
    addTrack({
      id: insert.id!,
      filepath: data.filepath,
      filename: null,
      title: data.title,
      artist: data.artist,
      album: data.album,
      genre: data.genre,
      year: data.year,
      comment: data.comment,
      label: data.label,
      remixer: data.remixer,
      composer: data.composer,
      grouping: data.grouping,
      bpm: data.bpm,
      key_camelot: data.key_camelot,
      key_full: data.key_full,
      camelot: data.camelot,
      openkey: null,
      duration_sec: data.duration_sec,
      duration_str: data.duration_str,
      file_size_mb: null,
      format: null,
      waveform: null,
      artwork_path: null,
      board_column: 'Untagged',
      energy: null,
      analyzed_at: new Date().toISOString(),
      added_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_modified: null,
      missing: 0,
      needs_sync: 0,
      pending_changes: null,
      last_seen_at: null,
    })

    setAnalyzing(false)
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>

      <h2>CrateCloud v2</h2>
      <p style={{ color: '#555', marginBottom: '1rem' }}>
        {tracks.length} track{tracks.length !== 1 ? 's' : ''} in library
      </p>

      <button
        onClick={handleAnalyzeFile}
        disabled={isAnalyzing}
        style={{ marginBottom: '1rem', padding: '8px 16px' }}
      >
        {isAnalyzing ? 'Analyzing...' : 'Analyze test file'}
      </button>

      {/* Track list */}
      <div>
        {tracks.map((track) => (
          <div
            key={track.id}
            style={{
              padding: '8px 12px',
              marginBottom: '4px',
              background: '#1a1a26',
              borderRadius: '6px',
              color: '#e8e8f0',
            }}
          >
            <div style={{ fontWeight: 500 }}>
              {track.title ?? 'Untitled'} — {track.artist ?? 'Unknown'}
            </div>
            <div style={{ color: '#666', fontSize: '12px', marginTop: '2px' }}>
              {track.bpm} BPM · {track.key_camelot} · {track.duration_str}
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}

export default App
