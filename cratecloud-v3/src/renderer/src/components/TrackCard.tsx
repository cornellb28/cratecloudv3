import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { usePlayerStore } from '../store/usePlayerStore'
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
  onSelect
}: TrackCardProps): React.JSX.Element {
  const { activeTrackId, setActiveTrack, trackTags } = useLibraryStore()
  const { currentTrack, isPlaying, playTrack, togglePlayPause } = usePlayerStore()
  const isActive = activeTrackId === track.id
  const appliedTags = trackTags.get(track.id) ?? []
  const commentTags = appliedTags.filter((t) => t.field === 'comment')
  const artworkUrl = useArtworkUrl(track.artwork_hash, 'thumb')

  const isCurrentTrack = currentTrack?.id === track.id
  const isMissing = !!track.missing

  function handlePlayToggle(e: React.MouseEvent): void {
    e.stopPropagation()
    if (isMissing || !track.filepath) return
    if (isCurrentTrack) togglePlayPause()
    else playTrack(track)
  }

  return (
    <div
      style={{
        background: isSelected ? '#1e1b3a' : isActive ? '#1a1830' : '#1a1a26',
        border: isActive
          ? '0.5px solid #7f77dd'
          : isSelected
            ? '0.5px solid #3a3060'
            : '0.5px solid #252535',
        borderRadius: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transition: 'all 0.1s'
      }}
    >
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
          flexShrink: 0,
          position: 'relative'
        }}
      >
        {/* Checkbox overlay - top left corner */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '6px',
            left: '6px',
            zIndex: 2
          }}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelect?.(track.id)}
            className="border-[rgba(255,255,255,0.4)] bg-[rgba(0,0,0,0.45)] data-[state=checked]:bg-[#7f77dd] data-[state=checked]:border-[#7f77dd]"
          />
        </div>

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

        {/* Play/pause overlay — bottom-right corner of the artwork */}
        {!isMissing && track.filepath && (
          <button
            data-testid={`track-play-${track.id}`}
            onClick={handlePlayToggle}
            title={isCurrentTrack && isPlaying ? 'Pause' : 'Play'}
            style={{
              position: 'absolute',
              bottom: '6px',
              right: '6px',
              zIndex: 2,
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              border: 'none',
              background: isCurrentTrack ? '#7f77dd' : 'rgba(0,0,0,0.55)',
              color: '#fff',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {isCurrentTrack && isPlaying ? '⏸' : '▶'}
          </button>
        )}
      </div>

      <MoveFileButton track={track} />

      {/* Info */}
      <div
        onClick={() => setActiveTrack(isActive ? null : track.id)}
        style={{ padding: '8px 10px', flex: 1, cursor: 'pointer' }}
      >
        {/* Title */}
        <div
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: '#e0e0f0',
            marginBottom: '2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {track.title ?? track.filename ?? 'Untitled'}
        </div>

        {/* Artist */}
        <div
          style={{
            fontSize: '11px',
            color: '#555',
            marginBottom: '6px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {track.artist ?? 'Unknown'}
        </div>

        {/* BPM + Key */}
        <div
          style={{
            display: 'flex',
            gap: '3px',
            flexWrap: 'wrap',
            marginBottom: commentTags.length > 0 ? '4px' : '0'
          }}
        >
          {track.bpm && (
            <Badge
              variant="outline"
              style={{
                fontSize: '9px',
                height: '16px',
                padding: '0 5px',
                background: '#1a2535',
                color: '#5d9fd8',
                borderColor: '#1a2535'
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
                borderColor: '#1a2830'
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
