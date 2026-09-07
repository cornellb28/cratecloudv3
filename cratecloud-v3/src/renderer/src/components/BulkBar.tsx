import { BulkEditModal } from './BulkEditModal'
import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'

interface BulkBarProps {
  selectedIds: number
  onClearSelect: boolean
}

export function BulkBar({ selectedIds, onClearSelect }: BulkBarProps) {
  const { quickTags, trackTags, setTrackTags } = useLibraryStore()
  const [applying, setApplying] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)

  if (selectedIds.size === 0) return null

  const selectedArray = Array.from(selectedIds)

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

        {/* Quick apply tags */}
        {quickTags.length > 0 && (
          <>
            <span style={{ fontSize: '11px', color: '#555' }}>
              Apply:
            </span>
            {quickTags.map(tag => (
              <Badge
                key={tag.id}
                variant="outline"
                onClick={() => !applying && applyTagToAll(tag)}
                style={{
                  fontSize: '11px',
                  cursor: applying ? 'wait' : 'pointer',
                  background: tag.color + '22',
                  color: tag.color,
                  borderColor: tag.color + '44',
                  opacity: applying ? 0.6 : 1,
                }}
              >
                {tag.value}
              </Badge>
            ))}
          </>
        )}

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
