import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { TrackRow } from '../components/TrackRow'
import { TrackCard } from '../components/TrackCard'
import { BulkBar } from '../components/BulkBar'

export function LibraryView(): React.JSX.Element {
  const { tracks, searchQuery, displayMode } = useLibraryStore()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const query = searchQuery.trim().toLowerCase()
  const filteredTracks = query
    ? tracks.filter(t => {
      const haystack = [
        t.title, t.artist, t.bpm,
        t.key_camelot, t.camelot, t.genre, t.comment,
      ]
        .filter(v => v !== null && v !== undefined)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
    : tracks

  function toggleSelect(id: number): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (tracks.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#333',
        fontSize: '14px',
      }}>
        No tracks yet — import a folder to get started
      </div>
    )
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* BulkBar — renders null when selectedIds is empty */}
      <BulkBar
        selectedIds={selectedIds}
        onClearSelect={() => setSelectedIds(new Set())}
        onSelectAll={() => setSelectedIds(new Set(filteredTracks.map((t) => t.id)))}
        totalCount={filteredTracks.length}
      />

      {filteredTracks.length === 0 && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#333',
          fontSize: '14px',
        }}>
          No tracks match your search
        </div>
      )}

      {/* List view */}
      {displayMode === 'list' && filteredTracks.length > 0 && (
        <div data-testid="track-list" style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {filteredTracks.map((track) => (
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
      {displayMode === 'grid' && filteredTracks.length > 0 && (
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
          {filteredTracks.map((track) => (
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
