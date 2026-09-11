import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Badge } from '@renderer/components/ui/badge'
import { TrackRow } from '../components/TrackRow'
import { TrackCard } from '../components/TrackCard'
import { BulkBar } from '../components/BulkBar'

interface TagPageViewProps {
  tag: Tag
  onBack: () => void
}

export function TagPageView({ tag, onBack }: TagPageViewProps): React.JSX.Element {
  const { tracks, trackTags, displayMode } = useLibraryStore()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Find all tracks that have this tag applied
  const taggedTrackIds = new Set<number>()
  trackTags.forEach((tagList, trackId) => {
    if (tagList.some((t) => t.id === tag.id)) {
      taggedTrackIds.add(trackId)
    }
  })

  const taggedTracks = tracks.filter((t) => taggedTrackIds.has(t.id))

  function toggleSelect(id: number): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '0.5px solid #1e1e2a',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexShrink: 0
        }}
      >
        {/* Back button */}
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: '0.5px solid #252535',
            borderRadius: '6px',
            color: '#555',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '4px 10px',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          ← Back
        </button>

        {/* Tag badge */}
        <Badge
          variant="outline"
          style={{
            background: tag.color + '22',
            color: tag.color,
            borderColor: tag.color + '44',
            fontSize: '13px',
            fontWeight: 500,
            padding: '4px 12px'
          }}
        >
          {tag.value}
        </Badge>

        {/* Field label */}
        <span style={{ fontSize: '12px', color: '#444' }}>{tag.field}</span>

        {/* Track count */}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '12px',
            color: '#555'
          }}
        >
          {taggedTracks.length} track{taggedTracks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Bulk bar */}
      <BulkBar
        selectedIds={selectedIds}
        onClearSelect={() => setSelectedIds(new Set())}
        onSelectAll={() => setSelectedIds(new Set(taggedTracks.map((t) => t.id)))}
        totalCount={taggedTracks.length}
      />

      {/* Empty state */}
      {taggedTracks.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#333',
            fontSize: '13px'
          }}
        >
          No tracks with this tag yet
        </div>
      )}

      {/* List view */}
      {displayMode === 'list' && taggedTracks.length > 0 && (
        <div data-testid="track-list" style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {taggedTracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              isSelected={selectedIds.has(track.id)}
              onSelected={toggleSelect}
            />
          ))}
        </div>
      )}

      {/* Grid view */}
      {displayMode === 'grid' && taggedTracks.length > 0 && (
        <div
          data-testid="track-list"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '10px',
            alignContent: 'start'
          }}
        >
          {taggedTracks.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              isSelected={selectedIds.has(track.id)}
              onSelect={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
