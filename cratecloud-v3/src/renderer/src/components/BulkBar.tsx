import { BulkEditModal } from './BulkEditModal'
import React, { useState, useRef } from 'react'
import { toast } from 'sonner'
import { useLibraryStore } from '../store/useLibraryStore'
import { Button } from './ui/button'
import { FolderTreeDropdown } from './FolderTreeDropdown'
import { CrossDeviceMoveDialog } from './CrossDeviceMoveDialog'
import { CratePicker } from './CratePicker'

interface BulkBarProps {
  selectedIds: Set<number>
  onClearSelect: () => void
  onSelectAll: () => void
  totalCount: number
  // When set, BulkBar is rendered inside that crate's own track list — swaps
  // in a "Remove from crate" action instead of (well, in addition to)
  // "Add to crate", since the selection is already scoped to one crate.
  crateId?: number
}

export function BulkBar({
  selectedIds,
  onClearSelect,
  totalCount,
  onSelectAll,
  crateId
}: BulkBarProps): React.JSX.Element | null {
  const { tracks, upsertJob, removeTracksFromCrateLocally } = useLibraryStore()
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [cratePickerOpen, setCratePickerOpen] = useState(false)
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 })
  const [pendingMove, setPendingMove] = useState<{
    path: string
    fileCount: number
    totalMB: number
  } | null>(null)
  const moveButtonRef = useRef<HTMLButtonElement>(null)
  const crateButtonRef = useRef<HTMLButtonElement>(null)

  // Hide when nothing is selected
  if (selectedIds.size === 0) return null

  const selectedArray = Array.from(selectedIds)

  function openMoveDropdown(): void {
    if (moveButtonRef.current) {
      const rect = moveButtonRef.current.getBoundingClientRect()
      setAnchor({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    setDropdownOpen(true)
  }

  function startMoveJob(destAbsolutePath: string): void {
    window.api.fs.moveFiles({ trackIds: selectedArray, destAbsolutePath }).then(({ jobId }) => {
      upsertJob({
        type: 'move',
        jobId,
        trackIds: selectedArray,
        phase: 'running',
        done: 0,
        total: selectedArray.length,
        currentFile: '',
        bytesCopied: 0,
        totalBytes: 0,
        crossDevice: false,
        failed: []
      })
      onClearSelect()
    })
  }

  async function handleSelectDestination(destAbsolutePath: string): Promise<void> {
    setDropdownOpen(false)

    const filepaths = tracks.filter((t) => selectedIds.has(t.id)).map((t) => t.filepath)
    const precheck = await window.api.fs.isCrossDevice(filepaths, destAbsolutePath)

    if (precheck.ok && precheck.crossDevice) {
      setPendingMove({
        path: destAbsolutePath,
        fileCount: filepaths.length,
        totalMB: (precheck.totalBytes ?? 0) / (1024 * 1024)
      })
      return
    }

    // Same device, or the precheck itself failed — let the move job surface
    // any real error per-file rather than blocking on a failed precheck.
    startMoveJob(destAbsolutePath)
  }

  async function handleRemoveFromCrate(): Promise<void> {
    if (crateId === undefined) return
    const result = await window.api.crates.removeTracks(crateId, selectedArray)
    if (result.ok) {
      removeTracksFromCrateLocally(crateId, selectedArray)
      toast.success(
        `Removed ${selectedArray.length} track${selectedArray.length !== 1 ? 's' : ''} from crate`
      )
      onClearSelect()
    } else {
      toast.error('Could not remove from crate', { description: result.error })
    }
  }

  return (
    <>
      {/* Bulk edit modal */}
      <BulkEditModal
        trackIds={selectedArray}
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
      />

      {/* Folder tree dropdown for bulk move */}
      {dropdownOpen && (
        <FolderTreeDropdown
          anchor={anchor}
          onSelect={(path) => void handleSelectDestination(path)}
          onClose={() => setDropdownOpen(false)}
        />
      )}

      {/* Cross-device confirmation */}
      {pendingMove && (
        <CrossDeviceMoveDialog
          open
          fileCount={pendingMove.fileCount}
          totalMB={pendingMove.totalMB}
          onConfirm={() => {
            startMoveJob(pendingMove.path)
            setPendingMove(null)
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}

      <div
        style={{
          background: '#1e1b3a',
          borderBottom: '0.5px solid #3a3060',
          padding: '7px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
          flexWrap: 'wrap'
        }}
      >
        {/* Count */}
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: '#a09be8',
            flexShrink: 0
          }}
        >
          {selectedIds.size} selected
        </span>

        {/* Select all */}
        <button
          onClick={onSelectAll}
          style={{
            background: 'none',
            border: '0.5px solid #3a3060',
            borderRadius: '5px',
            color: '#a09be8',
            fontSize: '11px',
            padding: '3px 10px',
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
        >
          Select all {totalCount}
        </button>

        {/* Edit labels button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditModalOpen(true)}
          className="text-xs"
          style={{ borderColor: '#7f77dd', color: '#a09be8' }}
        >
          Edit labels
        </Button>

        {/* Add to crate button */}
        <Button
          ref={crateButtonRef}
          variant="outline"
          size="sm"
          onClick={() => setCratePickerOpen((v) => !v)}
          className="text-xs"
          style={{ borderColor: '#7f77dd', color: '#a09be8' }}
        >
          Add to crate
        </Button>
        {cratePickerOpen && (
          <CratePicker
            trackIds={selectedArray}
            anchorRef={crateButtonRef}
            onClose={() => setCratePickerOpen(false)}
          />
        )}

        {/* Remove from crate — only when BulkBar is scoped to one crate's view */}
        {crateId !== undefined && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRemoveFromCrate()}
            className="text-xs"
            style={{ borderColor: '#3a3060', color: '#a09be8' }}
          >
            Remove from crate
          </Button>
        )}

        {/* Move to... button */}
        <Button
          ref={moveButtonRef}
          variant="outline"
          size="sm"
          onClick={openMoveDropdown}
          className="text-xs"
          style={{ borderColor: '#7f77dd', color: '#a09be8' }}
        >
          Move to...
        </Button>

        {/* Deselect */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelect}
          className="text-xs ml-auto"
          style={{ color: '#555' }}
        >
          Deselect all
        </Button>
      </div>
    </>
  )
}
