import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { BoardCard } from '../components/BoardCard'

export function BoardView(): React.JSX.Element {
  const { tracks, updateTrack, boards } = useLibraryStore()
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Per-column display mode — default grid
  const [colModes, setColModes] = useState<Record<number, 'grid' | 'list'>>({})

  function toggleSelected(id: number): void {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function getMode(boardId: number): 'grid' | 'list' {
    return colModes[boardId] ?? 'grid'
  }
  async function moveTrack(trackId: number, boardId: number): Promise<void> {
    updateTrack(trackId, { board_id: boardId })
    await window.api.db.updateBoardId(trackId, boardId)
  }

  function onDragOver(e: React.DragEvent): void { e.preventDefault() }

  function onDrop(e: React.DragEvent, boardId: number): void {
    e.preventDefault()
    if (draggingId !== null) {
      moveTrack(draggingId, boardId)
      setDraggingId(null)
    }
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      gap: '10px',
      padding: '12px',
      overflowX: 'auto',
      overflowY: 'hidden',
    }}>
      {boards.map((board) => {
        const colTracks = tracks.filter(t => t.board_id === board.id)
        const mode = getMode(board.id)

        return (
          <div
            data-testid={`board-column-${board.id}`}
            key={board.id}
            onDragOver={onDragOver}
            onDrop={e => onDrop(e, board.id)}
            style={{
              width: '220px',
              flexShrink: 0,
              background: '#16161e',
              border: '0.5px solid #1e1e2a',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '100%',
            }}
          >
            {/* Column header */}
            <div style={{
              padding: '10px 12px',
              borderBottom: '0.5px solid #1e1e2a',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexShrink: 0,
            }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: board.color,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: '13px', fontWeight: 500, flex: 1 }}>
                {board.name}
              </span>
              <span style={{
                fontSize: '11px',
                background: '#1e1e2a',
                padding: '2px 7px',
                borderRadius: '10px',
                color: '#555',
              }}>
                {colTracks.length}
              </span>

              {/* List / Grid toggle */}
              <div style={{
                display: 'flex',
                gap: '1px',
                background: '#1a1a26',
                borderRadius: '4px',
                padding: '1px',
              }}>
                <button
                  onClick={() => setColModes(prev => ({ ...prev, [board.id]: 'list' }))}
                  title="List view"
                  style={{
                    background: mode === 'list' ? '#252535' : 'none',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '2px 5px',
                    cursor: 'pointer',
                    color: mode === 'list' ? '#a09be8' : '#444',
                    fontSize: '11px',
                    lineHeight: 1,
                  }}
                >
                  ☰
                </button>
                <button
                  onClick={() => setColModes(prev => ({ ...prev, [board.id]: 'grid' }))}
                  title="Grid view"
                  style={{
                    background: mode === 'grid' ? '#252535' : 'none',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '2px 5px',
                    cursor: 'pointer',
                    color: mode === 'grid' ? '#a09be8' : '#444',
                    fontSize: '11px',
                    lineHeight: 1,
                  }}
                >
                  ⊞
                </button>
              </div>
            </div>

            {/* Track cards */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px',
              display: mode === 'grid' ? 'grid' : 'flex',
              gridTemplateColumns: mode === 'grid' ? 'repeat(2, 1fr)' : undefined,
              flexDirection: mode === 'list' ? 'column' : undefined,
              gap: '6px',
              alignContent: 'start',
            }}>
              {colTracks.map(track => (
                <BoardCard
                  key={track.id}
                  track={track}
                  mode={mode}
                  isSelected={selectedIds.has(track.id)}
                  onSelect={toggleSelected}
                  onDragStart={id => setDraggingId(id)}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}

              {colTracks.length === 0 && (
                <div style={{
                  border: '1.5px dashed #252535',
                  borderRadius: '7px',
                  padding: '20px',
                  color: '#333',
                  fontSize: '12px',
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                }}>
                  Drop tracks here
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
