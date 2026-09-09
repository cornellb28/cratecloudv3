import { BulkEditModal } from './BulkEditModal'
import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

interface BulkBarProps {
  selectedIds: Set<number>
  onClearSelect: () => void
  onSelectAll: () => void
  totalCount: number
}

export function BulkBar({ selectedIds, onClearSelect, totalCount, onSelectAll }: BulkBarProps): React.JSX.Element | null {
  const { trackTags, setTrackTags } = useLibraryStore()
  const [editModalOpen, setEditModalOpen] = useState(false)

  // Hide when nothing is selected
  if (selectedIds.size === 0) return null

  const selectedArray = Array.from(selectedIds)

  // Apply a tag to every selected track

  return (
    <>
      {/* Bulk edit modal */}
      <BulkEditModal
        trackIds={selectedArray}
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
      />

      <div style={{
        background: '#1e1b3a',
        borderBottom: '0.5px solid #3a3060',
        padding: '7px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {/* Count */}
        <span style={{
          fontSize: '12px',
          fontWeight: 500,
          color: '#a09be8',
          flexShrink: 0,
        }}>
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
            fontFamily: 'inherit',
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
