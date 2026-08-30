import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'

interface TrackRowProps {
  track: Track
}

export function TrackRow({ track }: TrackRowProps): React.JSX.Element {
  const { activeTrackId, setActiveTrack } = useLibraryStore()
  const isActive = activeTrackId === track.id

  return (
    <div
      onClick={() => setActiveTrack(isActive ? null : track.id)}
      style={{
        padding: '8px 16px',
        marginBottom: '2px',
        background: isActive ? '#1a1830' : '#1a1a26',
        borderRadius: '6px',
        cursor: 'pointer',
        border: isActive ? '0.5px solid #7f77dd' : '0.5px solid transparent',
        transition: 'all 0.1s'
      }}
    >
      <div style={{ fontWeight: 500, fontSize: '13px' }}>
        {track.title ?? track.filename ?? 'Untitled'}
        <span style={{ color: '#555', fontWeight: 400 }}>
          {' '}— {track.artist ?? 'Unknown'}
        </span>
      </div>
      <div style={{
        color: '#555',
        fontSize: '11px',
        marginTop: '3px',
        display: 'flex',
        gap: '8px',
      }}>
        {track.bpm && (
          <span style={{ background: '#1a2535', color: '#5d9fd8', padding: '1px 6px', borderRadius: '4px' }}>
            {track.bpm} BPM
          </span>
        )}
        {track.key_camelot && (
          <span style={{ background: '#1a2830', color: '#3db88a', padding: '1px 6px', borderRadius: '4px' }}>
            {track.key_camelot}
          </span>
        )}
        {track.duration_str && (
          <span>{track.duration_str}</span>
        )}
      </div>
    </div>
  )
}
