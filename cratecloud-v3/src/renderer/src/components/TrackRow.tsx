import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { usePlayerStore } from '../store/usePlayerStore'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { useArtworkUrl } from '../hooks/useArtworkUrl'
import { TrackRowMenu } from './TrackRowMenu'

interface TrackRowProps {
  track: Track
  isSelected?: boolean
  onSelected?: (id: number) => void
  // Set when this row is rendered inside that crate's own track list — adds
  // a "Remove from crate" action to the row's "…" menu.
  crateId?: number
}

export function TrackRow({
  track,
  isSelected,
  onSelected,
  crateId
}: TrackRowProps): React.JSX.Element {
  const { activeTrackId, setActiveTrack, trackTags } = useLibraryStore()
  const { currentTrack, isPlaying, playTrack, togglePlayPause } = usePlayerStore()
  const isActive = activeTrackId === track.id
  const appliedTags = trackTags.get(track.id) ?? []
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
      data-testid={`track-row-${track.id}`}
      onClick={() => {
        setActiveTrack(isActive ? null : track.id)
        if (!isActive) usePlayerStore.getState().playTrack(track)
      }}
      style={{
        position: 'relative',
        padding: '8px 16px',
        marginBottom: '2px',
        background: isActive ? '#1a1830' : '#1a1a26',
        borderRadius: '6px',
        cursor: 'pointer',
        border: isActive ? '0.5px solid #7f77dd' : '0.5px solid transparent',
        transition: 'all 0.1s'
      }}
    >
      <div style={{ position: 'absolute', top: '8px', right: '12px' }}>
        <TrackRowMenu track={track} crateId={crateId} />
      </div>
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onSelected?.(track.id)}
        onClick={(e) => e.stopPropagation()}
        className="border-[#333] data-[state=checked]:bg-[#7f77dd] data-[state=checked]:border-[#7f77dd]"
      />
      {/* Artwork */}
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '4px',
          flexShrink: 0,
          overflow: 'hidden',
          background: '#1e1e2a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}
      >
        {artworkUrl ? (
          <img
            src={artworkUrl}
            loading="lazy"
            decoding="async"
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: '18px', color: '#333' }}>♪</span>
        )}

        {!isMissing && track.filepath && (
          <button
            data-testid={`track-play-${track.id}`}
            onClick={handlePlayToggle}
            title={isCurrentTrack && isPlaying ? 'Pause' : 'Play'}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              border: 'none',
              background: isCurrentTrack ? 'rgba(127,119,221,0.55)' : 'rgba(0,0,0,0.35)',
              color: '#fff',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isCurrentTrack ? 1 : 0,
              transition: 'opacity 0.1s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => {
              if (!isCurrentTrack) e.currentTarget.style.opacity = '0'
            }}
          >
            {isCurrentTrack && isPlaying ? '⏸' : '▶'}
          </button>
        )}
      </div>
      <div style={{ fontWeight: 500, fontSize: '13px' }}>
        {track.title ?? track.filename ?? 'Untitled'}
        <span style={{ color: '#555', fontWeight: 400 }}> — {track.artist ?? 'Unknown'}</span>
      </div>
      <div
        style={{
          color: '#555',
          fontSize: '11px',
          marginTop: '3px',
          display: 'flex',
          gap: '8px'
        }}
      >
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
        {track.duration_str && <span>{track.duration_str}</span>}
        {track.genre && (
          <Badge
            variant="outline"
            className="text-[10px] h-5 px-1.5 bg-[#261f3a] text-[#9b8ed4] border-[#261f3a] font-mono"
          >
            {track.genre}
          </Badge>
        )}
        {/* Applied tag badges */}
        {appliedTags.map((tag) => (
          <Badge
            key={tag.id}
            variant="outline"
            style={{
              fontSize: '10px',
              background: tag.color + '22',
              color: tag.color,
              borderColor: tag.color + '44',
              fontWeight: 500,
              height: '18px',
              padding: '0 6px'
            }}
          >
            {tag.value}
          </Badge>
        ))}
      </div>
    </div>
  )
}
