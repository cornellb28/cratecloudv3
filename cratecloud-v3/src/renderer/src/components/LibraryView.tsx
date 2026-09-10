import React, { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { TrackRow } from '../components/TrackRow'
import { BulkBar } from '../components/BulkBar'
import { VirtualizedTrackGrid, type VirtualizedTrackGridHandle } from '../components/VirtualizedTrackGrid'
import { useViewMode } from '../hooks/useViewMode'

export function LibraryView(): React.JSX.Element {
  const { tracks, searchQuery } = useLibraryStore()
  const [mode] = useViewMode('all_tracks', 'list')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const listRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<VirtualizedTrackGridHandle>(null)
  // Last first-visible track index seen in whichever mode is currently
  // mounted — read back when `mode` flips so the other mode can pick up
  // roughly where the DJ left off instead of resetting to the top.
  const lastVisibleIndexRef = useRef(0)
  const prevModeRef = useRef(mode)

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

  function handleListScroll(): void {
    const container = listRef.current
    if (!container) return
    const top = container.scrollTop
    for (const child of Array.from(container.children)) {
      const el = child as HTMLElement
      if (el.offsetTop + el.offsetHeight > top) {
        lastVisibleIndexRef.current = Number(el.dataset.index ?? 0)
        return
      }
    }
  }

  // Restore scroll position across a list<->grid switch — maps the last
  // visible track index from whichever mode was active a moment ago onto
  // whichever mode just mounted.
  useEffect(() => {
    if (prevModeRef.current === mode) return
    prevModeRef.current = mode
    const index = lastVisibleIndexRef.current
    requestAnimationFrame(() => {
      if (mode === 'list') {
        listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'start' })
      } else {
        gridRef.current?.scrollToTrackIndex(index)
      }
    })
  }, [mode])

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
      {mode === 'list' && filteredTracks.length > 0 && (
        <div
          ref={listRef}
          data-testid="track-list"
          onScroll={handleListScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}
        >
          {filteredTracks.map((track, index) => (
            <div key={track.id} data-index={index}>
              <TrackRow
                track={track}
                isSelected={selectedIds.has(track.id)}
                onSelected={toggleSelect}
              />
            </div>
          ))}
        </div>
      )}

      {/* Grid view — virtualized, bounded DOM nodes regardless of library size */}
      {mode === 'grid' && filteredTracks.length > 0 && (
        <VirtualizedTrackGrid
          ref={gridRef}
          tracks={filteredTracks}
          selectedIds={selectedIds}
          onSelect={toggleSelect}
          onVisibleIndexChange={(index) => {
            lastVisibleIndexRef.current = index
          }}
        />
      )}
    </div>
  )
}
