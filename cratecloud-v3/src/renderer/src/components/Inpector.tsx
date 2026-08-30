import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'

export function Inspector(): React.JSX.Element {
  const { tracks, activeTrackId, setActiveTrack } = useLibraryStore()

  const track = tracks.find((t) => t.id === activeTrackId) ?? null
  const isOpen = track !== null

  return (
    <div style={{
      width: isOpen ? '260px' : '0px',
      flexShrink: 0,
      background: '#12121a',
      borderLeft: isOpen ? '0.5px solid #1e1e2a' : 'none',
      overflowY: isOpen ? 'auto' : 'hidden',
      overflowX: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.25s ease',
    }}>

      {/* Only render content when open — prevents invisible content */}
      {isOpen && track && (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '260px' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '2px' }}>
                {track.title ?? track.filename ?? 'Untitled'}
              </div>
              <div style={{ color: '#666', fontSize: '12px' }}>
                {track.artist ?? 'Unknown artist'}
              </div>
            </div>
            <button
              onClick={() => setActiveTrack(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#444',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: '0.5px', background: '#1e1e2a' }} />

          {/* Metadata fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Field label="BPM" value={track.bpm?.toString()} />
            <Field label="Key" value={track.key_camelot} />
            <Field label="Key full" value={track.key_full} />
            <Field label="Energy" value={track.energy?.toString()} />
            <Field label="Genre" value={track.genre} />
            <Field label="Album" value={track.album} />
            <Field label="Year" value={track.year} />
            <Field label="Duration" value={track.duration_str} />
            <Field label="Format" value={track.format} />
          </div>

          {/* Divider */}
          <div style={{ height: '0.5px', background: '#1e1e2a' }} />

          {/* File path */}
          <div>
            <div style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: '#333',
              marginBottom: '4px',
            }}>
              File path
            </div>
            <div style={{
              fontSize: '10px',
              color: '#444',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}>
              {track.filepath}
            </div>
          </div>

        </div>
      )}

    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }): React.JSX.Element | null {
  if (!value) return null

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{
        fontSize: '11px',
        fontWeight: 500,
        letterSpacing: '0.6px',
        textTransform: 'uppercase',
        color: '#444',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: '12px',
        color: '#c0c0d8',
        textAlign: 'right',
        maxWidth: '160px',
      }}>
        {value}
      </span>
    </div>
  )
}
