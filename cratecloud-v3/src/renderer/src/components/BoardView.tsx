import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'

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

  function onDragStart(trackId: number): void { setDraggingId(trackId) }
  function onDragEnd(): void { setDraggingId(null) }
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
      flex: 1, display: 'flex', gap: '10px',
      padding: '12px', overflowX: 'auto', overflowY: 'hidden',
    }}>
      {boards.map(board => {
        // Filter by board_id now — not board_column string
        const colTracks = tracks.filter(t => t.board_id === board.id)

        return (
          <div
            data-testid={`board-column-${board.id}`}
            key={board.id}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, board.id)}
            style={{
              width: '220px', flexShrink: 0,
              background: '#16161e', border: '0.5px solid #1e1e2a',
              borderRadius: '10px', display: 'flex',
              flexDirection: 'column', maxHeight: '100%',
            }}
          >
            {/* Column header */}
            <div style={{
              padding: '10px 12px', borderBottom: '0.5px solid #1e1e2a',
              display: 'flex', gap: '8px', flexShrink: 0,
            }}>
              <div style={{
                width: '8px', height: '8px',
                borderRadius: '50%', background: board.color, flexShrink: 0,
              }} />
              <span style={{ fontSize: '13px', fontWeight: 500, flex: 1 }}>
                {board.name}
              </span>
              <span style={{
                fontSize: '11px', background: '#1e1e2a',
                padding: '2px 7px', borderRadius: '10px', color: '#555',
              }}>
                {colTracks.length}
              </span>
            </div>

            {/* Track cards */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '8px',
              display: 'flex', flexDirection: 'column', gap: '6px',
            }}>
              {colTracks.map(track => (
                <div
                  key={track.id}
                  draggable
                  onDragStart={() => onDragStart(track.id)}
                  onDragEnd={onDragEnd}
                  style={{
                    background: draggingId === track.id ? '#252535' : '#1a1a26',
                    border: '0.5px solid #252535',
                    borderRadius: '7px',
                    padding: '8px 10px',
                    cursor: 'grab',
                    opacity: draggingId === track.id ? 0.5 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  <div style={{
                    fontSize: '12px', fontWeight: 500, color: '#e0e0f0',
                    marginBottom: '4px', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {track.title ?? track.filename ?? 'Untitled'}
                  </div>
                  <div style={{
                    fontSize: '11px', color: '#555', marginBottom: '6px',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {track.artist ?? 'Unknown'}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {track.bpm && (
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: '#1a2535', color: '#5d9fd8' }}>
                        {track.bpm}
                      </span>
                    )}
                    {track.key_camelot && (
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: '#1a2830', color: '#3db88a' }}>
                        {track.key_camelot}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {colTracks.length === 0 && (
                <div style={{
                  border: '1.5px dashed #252535', borderRadius: '7px',
                  padding: '20px', color: '#333', fontSize: '12px',
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
