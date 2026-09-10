import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { TrackCard } from './TrackCard'

const CARD_MIN_WIDTH = 160
const GAP = 10
// TrackCard's own-height content below the (square) artwork — title line,
// artist line, BPM/key badges, optional comment-tag row. Not exact for
// every card (a wrapped comment-tag row can run taller), same tradeoff
// FolderView/BoardView's own non-virtualized grids already accept; fixed
// row height is what virtualization needs to avoid measuring every card.
const INFO_HEIGHT = 84

export interface VirtualizedTrackGridHandle {
  scrollToTrackIndex: (index: number) => void
}

interface VirtualizedTrackGridProps {
  tracks: Track[]
  selectedIds: Set<number>
  onSelect: (id: number) => void
  // Fires (via effect, so at most one render behind scroll) with the track
  // index at the top of the viewport — the caller keeps this in a ref so
  // it has somewhere to scroll list mode to if the DJ switches away from
  // grid a moment later.
  onVisibleIndexChange?: (index: number) => void
}

// Reusable grid body: virtualized in rows (fixed row height, bounded DOM
// node count regardless of library size), responsive column count from the
// container's own width. Deliberately just tracks/selectedIds/onSelect —
// no search, no BulkBar, no view-specific wiring — so FolderView or another
// view can adopt it later without needing to change how All Tracks uses it.
export const VirtualizedTrackGrid = forwardRef<
  VirtualizedTrackGridHandle,
  VirtualizedTrackGridProps
>(function VirtualizedTrackGrid({ tracks, selectedIds, onSelect, onVisibleIndexChange }, ref) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = parentRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w !== undefined) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const columns = width > 0 ? Math.max(1, Math.floor((width + GAP) / (CARD_MIN_WIDTH + GAP))) : 1
  const columnWidth = columns > 0 ? (width - GAP * (columns - 1)) / columns : CARD_MIN_WIDTH
  const rowHeight = Math.max(columnWidth, 1) + INFO_HEIGHT + GAP
  const rowCount = Math.ceil(tracks.length / columns)

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4
  })

  useImperativeHandle(
    ref,
    () => ({
      scrollToTrackIndex: (index) => {
        rowVirtualizer.scrollToIndex(Math.floor(index / columns), { align: 'start' })
      }
    }),
    [rowVirtualizer, columns]
  )

  const firstVisibleRow = rowVirtualizer.getVirtualItems()[0]?.index ?? 0
  useEffect(() => {
    onVisibleIndexChange?.(firstVisibleRow * columns)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstVisibleRow, columns])

  return (
    <div
      ref={parentRef}
      data-testid="track-grid"
      style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}
    >
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          position: 'relative',
          width: '100%'
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columns
          const rowTracks = tracks.slice(startIndex, startIndex + columns)
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${rowHeight}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: `${GAP}px`
              }}
            >
              {rowTracks.map((track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  isSelected={selectedIds.has(track.id)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
})
