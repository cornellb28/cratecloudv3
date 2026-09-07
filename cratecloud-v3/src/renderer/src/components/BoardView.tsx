import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { BoardCard } from '../components/BoardCard'

// Boards now come from the store — loaded from SQLite
// Add boards to your Zustand store (see below)

export function BoardView(): React.JSX.Element {
  const { tracks, updateTrack, boards } = useLibraryStore()
  const [draggingId, setDraggingId] = useState<number | null>(null)

  async function moveTrack(trackId: number, boardId: number): Promise<void> {
    // Optimistic update
    updateTrack(trackId, { board_id: boardId })
    // Persist
    await window.api.db.updateBoardId(trackId, boardId)
  }

  function onDragStart(trackId: number): void {
    setDraggingId(trackId)
  }
  function onDragEnd(): void {
    setDraggingId(null)
  }
  function onDragOver(e: React.DragEvent): void {
    e.preventDefault()
  }

  function onDrop(e: React.DragEvent, boardId: number): void {
    e.preventDefault()
    if (draggingId !== null) {
      moveTrack(draggingId, boardId)
      setDraggingId(null)
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        gap: '10px',
        padding: '12px',
        overflowX: 'auto',
        overflowY: 'hidden'
      }}
    >
      {boards.map((board) => {
        // Filter by board_id now — not board_column string
        const colTracks = tracks.filter((t) => t.board_id === board.id)

        return (
          <div
            data-testid={`board-column-${board.id}`}
            key={board.id}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, board.id)}
            style={{
              width: '220px',
              flexShrink: 0,
              background: '#16161e',
              border: '0.5px solid #1e1e2a',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '100%'
            }}
          >
            {/* Column header */}
            <div
              style={{
                padding: '10px 12px',
                borderBottom: '0.5px solid #1e1e2a',
                display: 'flex',
                gap: '8px',
                flexShrink: 0
              }}
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: board.color,
                  flexShrink: 0
                }}
              />
              <span style={{ fontSize: '13px', fontWeight: 500, flex: 1 }}>{board.name}</span>
              <span
                style={{
                  fontSize: '11px',
                  background: '#1e1e2a',
                  padding: '2px 7px',
                  borderRadius: '10px',
                  color: '#555'
                }}
              >
                {colTracks.length}
              </span>
            </div>

            {/* Track cards */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              {colTracks.map((track) => (
                <BoardCard
                  key={track.id}
                  track={track}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              ))}

              {colTracks.length === 0 && (
                <div
                  style={{
                    border: '1.5px dashed #252535',
                    borderRadius: '7px',
                    padding: '20px',
                    color: '#333',
                    fontSize: '12px'
                  }}
                >
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
