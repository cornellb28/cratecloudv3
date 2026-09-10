import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { MoveFileButton } from './MoveFileButton'
import { useArtworkUrl } from '../hooks/useArtworkUrl'

interface TrackCardProps {
  track: Track
  isSelected?: boolean
  onSelect?: (id: number) => void
}

export function TrackCard({
  track,
  isSelected = false,
  onSelect,
}: TrackCardProps): React.JSX.Element {
  const { activeTrackId, setActiveTrack, trackTags } = useLibraryStore()
  const isActive = activeTrackId === track.id
  const appliedTags = trackTags.get(track.id) ?? []
  const commentTags = appliedTags.filter(t => t.field === 'comment')
  const artworkUrl = useArtworkUrl(track.artwork_hash, 'thumb')

  return (
    <div
      style={{
        background: isSelected ? '#1e1b3a' : isActive ? '#1a1830' : '#1a1a26',
        border: isActive ? '0.5px solid #7f77dd' : isSelected ? '0.5px solid #3a3060' : '0.5px solid #252535',
        borderRadius: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transition: 'all 0.1s'
      }}
    >
      {/* Checkbox — top left corner */}
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onSelect?.(track.id)}
        onClick={e => e.stopPropagation()}
        className="border-[#333] data-[state=checked]:bg-[#7f77dd] data-[state=checked]:border-[#7f77dd]"
      />

      {/* Artwork */}
      <div
        onClick={() => setActiveTrack(isActive ? null : track.id)}
        style={{
          width: '100%',
          aspectRatio: '1',
          background: '#1e1e2a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: 'pointer',
          flexShrink: 0
        }}
      >
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: '32px', color: '#2a2a3a' }}>♪</span>
        )}
      </div>

      <MoveFileButton track={track} />

      {/* Info */}
      <div
        onClick={() => setActiveTrack(isActive ? null : track.id)}
        style={{ padding: '8px 10px', flex: 1, cursor: 'pointer' }}
      >
        {/* Title */}
        <div style={{
          fontSize: '12px',
          fontWeight: 500,
          color: '#e0e0f0',
          marginBottom: '2px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {track.title ?? track.filename ?? 'Untitled'}
        </div>

        {/* Artist */}
        <div style={{
          fontSize: '11px',
          color: '#555',
          marginBottom: '6px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {track.artist ?? 'Unknown'}
        </div>

        {/* BPM + Key */}
        <div style={{
          display: 'flex',
          gap: '3px',
          flexWrap: 'wrap',
          marginBottom: commentTags.length > 0 ? '4px' : '0',
        }}>
          {track.bpm && (
            <Badge
              variant="outline"
              style={{
                fontSize: '9px',
                height: '16px',
                padding: '0 5px',
                background: '#1a2535',
                color: '#5d9fd8',
                borderColor: '#1a2535',
              }}
            >
              {track.bpm}
            </Badge>
          )}
          {track.key_camelot && (
            <Badge
              variant="outline"
              style={{
                fontSize: '9px',
                height: '16px',
                padding: '0 5px',
                background: '#1a2830',
                color: '#3db88a',
                borderColor: '#1a2830',
              }}
            >
              {track.key_camelot}
            </Badge>
          )}
        </div>

        {/* Comment tags */}
        {commentTags.length > 0 && (
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
            {commentTags.map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                style={{
                  fontSize: '9px',
                  height: '16px',
                  padding: '0 5px',
                  background: tag.color + '22',
                  color: tag.color,
                  borderColor: tag.color + '44',
                  fontWeight: 500
                }}
              >
                {tag.value}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
