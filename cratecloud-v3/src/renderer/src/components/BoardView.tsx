import React, { useState } from 'react'
import { toast } from 'sonner'
import { useLibraryStore } from '../store/useLibraryStore'
import { BoardCard } from '../components/BoardCard'
import { useFileDrop } from '../hooks/useFileDrop'

export function BoardView(): React.JSX.Element {
  const { tracks, updateTrack, boards, setTracks } = useLibraryStore()
  const [draggingId, setDraggingId] = useState<number | null>(null)

  // Per-column display mode — default grid
  const [colModes, setColModes] = useState<Record<number, 'grid' | 'list'>>({})

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

  // Drag-and-drop from Finder onto a board column — same importFile the
  // dialogs call, routed by fs:classify-paths, then added to the board via
  // the same updateBoardId path as an internal card drag. Directories can't
  // be imported "into" a board (a board is a tag, not a filesystem
  // location), so they're just pointed at the Folders view instead.
  async function handleDropOntoBoard(paths: string[], boardId: number): Promise<void> {
    const classified = await window.api.fs.classifyPaths(paths)
    const audioFiles = classified.filter((c) => c.kind === 'audio').map((c) => c.path)
    const dirs = classified.filter((c) => c.kind === 'dir')
    const skipped = classified.filter((c) => c.kind === 'other')

    for (const filepath of audioFiles) {
      const result = await window.api.importFile(filepath)
      if (result.ok && result.trackId !== undefined) {
        await moveTrack(result.trackId, boardId)
      }
    }
    if (audioFiles.length > 0) {
      const all = await window.api.db.allTracks()
      setTracks(all)
    }

    if (dirs.length > 0) {
      toast.warning('Drop folders onto the Folders view to import them', {
        description: `${dirs.length} folder${dirs.length !== 1 ? 's' : ''} skipped here`
      })
    }
    if (skipped.length > 0) {
      toast.warning(
        `Skipped ${skipped.length} unsupported file${skipped.length !== 1 ? 's' : ''}`,
        { description: skipped.map((c) => c.path.split('/').pop()).join(', ') }
      )
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
      {boards.map((board) => (
        <BoardColumn
          key={board.id}
          board={board}
          tracks={tracks.filter(t => t.board_id === board.id)}
          mode={getMode(board.id)}
          onSetMode={(mode) => setColModes(prev => ({ ...prev, [board.id]: mode }))}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onCardDragStart={setDraggingId}
          onCardDragEnd={() => setDraggingId(null)}
          onDropPaths={handleDropOntoBoard}
        />
      ))}
    </div>
  )
}

// TODO: dropping onto the sidebar/folder-tree nodes (as opposed to this
// board grid) is explicitly out of scope for this pass — see
// useFileDrop's usage here and in FolderView for the pattern to reuse.
function BoardColumn({
  board,
  tracks: colTracks,
  mode,
  onSetMode,
  onDragOver,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onDropPaths
}: {
  board: Board
  tracks: Track[]
  mode: 'grid' | 'list'
  onSetMode: (mode: 'grid' | 'list') => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, boardId: number) => void
  onCardDragStart: (id: number) => void
  onCardDragEnd: () => void
  onDropPaths: (paths: string[], boardId: number) => void
}): React.JSX.Element {
  const { isDragging, dropHandlers } = useFileDrop({
    onDrop: (paths) => onDropPaths(paths, board.id)
  })

  return (
    <div
      data-testid={`board-column-${board.id}`}
      onDragOver={(e) => { onDragOver(e); dropHandlers.onDragOver(e) }}
      onDragEnter={dropHandlers.onDragEnter}
      onDragLeave={dropHandlers.onDragLeave}
      onDrop={(e) => {
        // Internal track drags carry no Files type, so this always resolves
        // to exactly one of the two paths, never both.
        onDrop(e, board.id)
        dropHandlers.onDrop(e)
      }}
      style={{
        width: '220px',
        flexShrink: 0,
        background: '#16161e',
        border: isDragging ? '2px dashed #7f77dd' : '0.5px solid #1e1e2a',
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
        <span style={{
          fontSize: '13px',
          fontWeight: 500,
          flex: 1,
          color: isDragging ? '#a09be8' : undefined
        }}>
          {isDragging ? `Add to ${board.name}` : board.name}
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
            onClick={() => onSetMode('list')}
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
            onClick={() => onSetMode('grid')}
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
            isSelected={false}
            onDragStart={onCardDragStart}
            onDragEnd={onCardDragEnd}
          />
        ))}

        {colTracks.length === 0 && (
          <div style={{
            border: isDragging ? '1.5px dashed #7f77dd' : '1.5px dashed #252535',
            borderRadius: '7px',
            padding: '20px',
            color: isDragging ? '#a09be8' : '#333',
            fontSize: '12px',
            gridColumn: '1 / -1',
            textAlign: 'center',
          }}>
            {isDragging ? `Add to ${board.name}` : 'Drop tracks here'}
          </div>
        )}
      </div>
    </div>
  )
}
