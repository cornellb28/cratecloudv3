import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { usePlayerStore } from '../store/usePlayerStore'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { useArtworkUrl } from '../hooks/useArtworkUrl'
import { TrackRowMenu } from './TrackRowMenu'

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
  const { activeTrackId, setActiveTrack, trackTags, boards } = useLibraryStore()
  const { currentTrack, isPlaying, playTrack, togglePlayPause } = usePlayerStore()
  const [hovered, setHovered] = useState(false)

  const isActive = activeTrackId === track.id
  const isCurrentTrack = currentTrack?.id === track.id
  const isMissing = !!track.missing

  const appliedTags = trackTags.get(track.id) ?? []
  const commentTags = appliedTags.filter((t) => t.field === 'comment')
  const artworkUrl = useArtworkUrl(track.artwork_hash, 'thumb')

  // Board pill
  const board = boards.find((b) => b.id === track.board_id)

  function handlePlayToggle(e: React.MouseEvent): void {
    e.stopPropagation()
    if (isMissing || !track.filepath) return
    if (isCurrentTrack) togglePlayPause()
    else playTrack(track)
  }

  const borderColor = isActive
    ? '#7f77dd'
    : isSelected
      ? '#3a3060'
      : hovered
        ? '#2a2a40'
        : '#1e1e2a' // ← subtler default border
  const bgColor = isSelected ? '#1e1b3a' : isActive ? '#1a1830' : hovered ? '#1e1e2c' : '#13131b' // ← darker default so hover is visible

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: bgColor,
        border: `0.5px solid ${borderColor}`,
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        transition: 'all 0.1s',
        opacity: isMissing ? 0.6 : 1
      }}
    >
      {/* Artwork */}
      <div
        onClick={() => setActiveTrack(isActive ? null : track.id)}
        style={{
          width: '100%',
          aspectRatio: '1',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          position: 'relative'
        }}
      >
        {/* Checkbox overlay - top left corner */}
        <div
          onClick={(e) => { e.stopPropagation(); onSelect?.(track.id) }}
          style={{
            position: 'absolute',
            top: '6px',
            left: '6px',
            zIndex: 3
          }}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelect?.(track.id)}
            onClick={(e) => e.stopPropagation()}
            className="border-[rgba(255,255,255,0.4)] bg-[rgba(0,0,0,0.45)] data-[state=checked]:bg-[#7f77dd] data-[state=checked]:border-[#7f77dd]"
          />
        </div>

        {/* ⋯ menu — top right */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            zIndex: 50,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.1s'
          }}
        >
          <TrackRowMenu track={track} />
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

        {/* Missing dot */}
        {isMissing && (
          <div
            title="File not Found on disk"
            style={{
              position: 'absolute',
              top: '6px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#e08a80',
              color: '#fff',
              fontSize: '9px',
              fontWeight: 500,
              padding: '2px 6px',
              borderRadius: '4px',
              zIndex: 3
            }}
          >
            ⚠ Missing
          </div>
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
              justifyContent: 'center',
              opacity: isCurrentTrack || hovered ? 1 : 0,
              transition: 'opacity 0.15s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => {
              if (!isCurrentTrack) e.currentTarget.style.opacity = '0'
            }}
          >
            {isCurrentTrack && isPlaying ? '⏸' : '▶'}
          </button>
        )}
      </div>

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
          {track.energy && (
            <Badge variant="outline" style={{
              fontSize: '9px', height: '16px', padding: '0 5px',
              background: '#261a1a', color: '#d4537e', borderColor: '#261a1a',
            }}>
              E{track.energy}
            </Badge>
          )}
        </div>

        {/* Board pill */}
        {board && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            marginBottom: commentTags.length > 0 ? '4px' : '0'
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: board.color,
              flexShrink: 0
            }} />
            <span style={{ fontSize: '9px', color: '#444' }}>
              {board.name}
            </span>
          </div>
        )}

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
