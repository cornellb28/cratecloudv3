import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Badge } from '@renderer/components/ui/badge'
// import { Checkbox } from '@renderer/components/ui/checkbox'
import { BoardCardModal } from '../components/BoardCardModal'
import { useArtworkUrl } from '../hooks/useArtworkUrl'

interface BoardCardProps {
  track: Track
  isSelected?: boolean
  onSelect?: (id: number) => void
  onDragStart?: (id: number) => void
  onDragEnd?: () => void
  mode?: 'grid' | 'list'
}

export function BoardCard({
  track,
  isSelected = false,
  onSelect,
  onDragStart,
  onDragEnd,
  mode = 'grid',
}: BoardCardProps): React.JSX.Element {
  const { activeTrackId, trackTags } = useLibraryStore()
  const [modalOpen, setModalOpen] = useState(false)

  const isActive = activeTrackId === track.id
  const artworkUrl = useArtworkUrl(track.artwork_hash, 'thumb')

  const appliedTags = trackTags.get(track.id) ?? []
  const commentTags = appliedTags.filter(t => t.field === 'comment')

  const borderColor = isActive
    ? '#7f77dd'
    : isSelected ? '#3a3060' : '#252535'

  // ── List mode ──────────────────────────────────────────
  if (mode === 'list') {
    return (
      <>
        <BoardCardModal track={track} open={modalOpen} onClose={() => setModalOpen(false)} />
        <div
          draggable
          onDragStart={() => onDragStart?.(track.id)}
          onDragEnd={onDragEnd}
          onClick={() => setModalOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 8px',
            background: isSelected ? '#1e1b3a' : '#1a1a26',
            border: `0.5px solid ${borderColor}`,
            borderRadius: '6px',
            cursor: 'pointer',
            transition: 'all 0.1s',
            minHeight: '44px',
          }}
        >
          {/* Checkbox */}
          {/* <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onSelect?.(track.id)}
              className="border-[rgba(255,255,255,0.3)] bg-[rgba(0,0,0,0.4)] data-[state=checked]:bg-[#7f77dd] data-[state=checked]:border-[#7f77dd]"
            />
          </div> */}

          {/* Artwork thumbnail */}
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '4px',
            background: '#1e1e2a',
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: '14px', color: '#333' }}>♪</span>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 500,
              color: '#e0e0f0',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {track.title ?? track.filename ?? 'Untitled'}
            </div>
            <div style={{
              fontSize: '10px',
              color: '#555',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {track.artist ?? 'Unknown'}
            </div>
          </div>

          {/* Badges */}
          <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
            {track.bpm && (
              <Badge variant="outline" style={{
                fontSize: '9px', height: '15px', padding: '0 4px',
                background: '#1a2535', color: '#5d9fd8', borderColor: '#1a2535',
              }}>
                {track.bpm}
              </Badge>
            )}
            {track.key_camelot && (
              <Badge variant="outline" style={{
                fontSize: '9px', height: '15px', padding: '0 4px',
                background: '#1a2830', color: '#3db88a', borderColor: '#1a2830',
              }}>
                {track.key_camelot}
              </Badge>
            )}
            {commentTags.slice(0, 2).map(tag => (
              <Badge key={tag.id} variant="outline" style={{
                fontSize: '9px', height: '15px', padding: '0 4px',
                background: tag.color + '22', color: tag.color,
                borderColor: tag.color + '44', fontWeight: 500,
              }}>
                {tag.value}
              </Badge>
            ))}
          </div>
        </div>
      </>
    )
  }

  // ── Grid mode (default) ────────────────────────────────
  return (
    <>
      <BoardCardModal track={track} open={modalOpen} onClose={() => setModalOpen(false)} />

      <div
        draggable
        onDragStart={() => onDragStart?.(track.id)}
        onDragEnd={onDragEnd}
        onClick={() => setModalOpen(true)}
        style={{
          background: isSelected ? '#1e1b3a' : '#1a1a26',
          border: `0.5px solid ${borderColor}`,
          borderRadius: '7px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          transition: 'all 0.1s',
          cursor: 'pointer',
          minHeight: '140px',
        }}
      >
        {/* Checkbox */}
        {/* <div
          style={{ position: 'absolute', top: '5px', left: '5px', zIndex: 2 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelect?.(track.id)}
            className="border-[rgba(255,255,255,0.3)] bg-[rgba(0,0,0,0.4)] data-[state=checked]:bg-[#7f77dd] data-[state=checked]:border-[#7f77dd]"
          />
        </div> */}

        {/* Artwork */}
        <div style={{
          width: '100%',
          aspectRatio: '1',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
          minHeight: '80px',
        }}>
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: '28px', color: '#2a2a3a' }}>♪</span>
          )}
        </div>

        {/* Info */}
        <div style={{ padding: '7px 8px', flex: 1 }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 500,
            color: '#e0e0f0',
            marginBottom: '2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {track.title ?? track.filename ?? 'Untitled'}
          </div>
          <div style={{
            fontSize: '10px',
            color: '#555',
            marginBottom: '5px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {track.artist ?? 'Unknown'}
          </div>

          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
            {track.bpm && (
              <Badge variant="outline" style={{
                fontSize: '9px', height: '15px', padding: '0 4px',
                background: '#1a2535', color: '#5d9fd8', borderColor: '#1a2535',
              }}>
                {track.bpm}
              </Badge>
            )}
            {track.key_camelot && (
              <Badge variant="outline" style={{
                fontSize: '9px', height: '15px', padding: '0 4px',
                background: '#1a2830', color: '#3db88a', borderColor: '#1a2830',
              }}>
                {track.key_camelot}
              </Badge>
            )}
            {commentTags.slice(0, 2).map(tag => (
              <Badge key={tag.id} variant="outline" style={{
                fontSize: '9px', height: '15px', padding: '0 4px',
                background: tag.color + '22', color: tag.color,
                borderColor: tag.color + '44', fontWeight: 500,
              }}>
                {tag.value}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
