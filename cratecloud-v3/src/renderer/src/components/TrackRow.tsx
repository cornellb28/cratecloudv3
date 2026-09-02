import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Badge } from '@renderer/components/ui/badge'

interface TrackRowProps {
  track: Track
}

export function TrackRow({ track }: TrackRowProps): React.JSX.Element {
  const { activeTrackId, setActiveTrack } = useLibraryStore()
  const isActive = activeTrackId === track.id

  const artworkUrl = track.artwork_path ? `artwork://${track.artwork_path}` : null

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
      {/* Artwork */}
      <div style={{
        width: '40px',
        height: '40px',
        borderRadius: '4px',
        flexShrink: 0,
        overflow: 'hidden',
        background: '#1e1e2a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: '18px', color: '#333' }}>♪</span>
        )}
      </div>
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
          <Badge
            variant="outline"
            className="text-[10px] h-5 px-1.5 bg-[#1a2535] text-[#5d9fd8] border-[#1a2535] font-mono"
          >
            {track.bpm} BPM
          </Badge>
        )}
        {track.key_camelot && (
          <Badge
            variant="outline"
            className="text-[10px] h-5 px-1.5 bg-[#1a2830] text-[#3db88a] border-[#1a2830] font-mono"
          >
            {track.key_camelot}
          </Badge>
        )}
        {track.duration_str && (
          <span>{track.duration_str}</span>
        )}
        {track.genre && (
          <Badge
            variant="outline"
            className="text-[10px] h-5 px-1.5 bg-[#261f3a] text-[#9b8ed4] border-[#261f3a] font-mono"
          >
            {track.genre}
          </Badge>
        )}
      </div>
    </div>
  )
}
