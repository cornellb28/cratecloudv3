import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { BoardCardModal } from '../components/BoardCardModal'

interface BoardCardProps {
  track: Track
  isSelected?: boolean
  onSelect?: (id: number) => void
  onDragStart?: (id: number) => void
  onDragEnd?: () => void
}

export function BoardCard({
  track,
  isSelected = false,
  onSelect,
  onDragStart,
  onDragEnd
}: BoardCardProps): React.JSX.Element {
  const { activeTrackId } = useLibraryStore()
  const [modalOpen, setModalOpen] = useState(false)

  const isActive = activeTrackId === track.id
  const artworkUrl = track.artwork_path ? `artwork://${track.artwork_path}` : null

  return (
    <>
      {/* Board card modal */}
      <BoardCardModal track={track} open={modalOpen} onClose={() => setModalOpen(false)} />

      <div
        draggable
        onDragStart={() => onDragStart?.(track.id)}
        onDragEnd={() => onDragEnd?.()}
        style={{
          background: isSelected ? '#1e1b3a' : '#1a1a26',
          border: isActive
            ? '0.5px solid #7f77dd'
            : isSelected
              ? '0.5px solid #3a3060'
              : '0.5px solid #252535',
          borderRadius: '7px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          transition: 'all 0.1s',
          cursor: 'pointer'
        }}
        onClick={() => setModalOpen(true)}
      >
        {/* Checkbox overlay */}
        <div
          style={{
            position: 'absolute',
            top: '5px',
            left: '5px',
            zIndex: 2
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelect?.(track.id)}
            className="border-[rgba(255,255,255,0.3)] bg-[rgba(0,0,0,0.4)] data-[state=checked]:bg-[#7f77dd] data-[state=checked]:border-[#7f77dd]"
          />
        </div>

        {/* Artwork */}
        <div
          style={{
            width: '100%',
            aspectRatio: '1',
            background: '#1e1e2a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0
          }}
        >
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: '28px', color: '#2a2a3a' }}>♪</span>
          )}
        </div>

        {/* Minimal info */}
        <div style={{ padding: '7px 8px' }}>
          <div
            style={{
              fontSize: '11px',
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
          <div
            style={{
              fontSize: '10px',
              color: '#555',
              marginBottom: '5px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {track.artist ?? 'Unknown'}
          </div>

          {/* BPM + Key only — no comment tags on board card */}
          <div style={{ display: 'flex', gap: '3px' }}>
            {track.bpm && (
              <Badge
                variant="outline"
                style={{
                  fontSize: '9px',
                  height: '15px',
                  padding: '0 4px',
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
                  height: '15px',
                  padding: '0 4px',
                  background: '#1a2830',
                  color: '#3db88a',
                  borderColor: '#1a2830'
                }}
              >
                {track.key_camelot}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
