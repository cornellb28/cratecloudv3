import React, { useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Badge } from '@renderer/components/ui/badge'

// Fields in alphabetical order
const FIELD_ORDER = [
  { field: 'album', label: 'Album' },
  { field: 'artist', label: 'Artist' },
  { field: 'comment', label: 'Comment' },
  { field: 'composer', label: 'Composer' },
  { field: 'genre', label: 'Genre' },
  { field: 'grouping', label: 'Grouping' },
  { field: 'label', label: 'Label' },
  { field: 'remixer', label: 'Remixer' }
]

interface TagsCloudViewProps {
  onTagSelect: (tag: Tag) => void
}

export function TagsCloudView({ onTagSelect }: TagsCloudViewProps): React.JSX.Element {
  const { tags } = useLibraryStore()

  // Track counts per tag — computed from trackTags map
  const { trackTags } = useLibraryStore()
  const tagCounts = new Map<number, number>()
  trackTags.forEach((tagList) => {
    tagList.forEach((tag) => {
      tagCounts.set(tag.id, (tagCounts.get(tag.id) ?? 0) + 1)
    })
  })

  // Which accordion sections are open — comment open by default
  const [openFields, setOpenFields] = useState<Set<string>>(new Set(['comment']))

  function toggleField(field: string): void {
    setOpenFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px'
      }}
    >
      <div
        style={{
          fontSize: '13px',
          fontWeight: 500,
          color: '#e8e8f0',
          marginBottom: '16px'
        }}
      >
        Tags Cloud
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {FIELD_ORDER.map(({ field, label }) => {
          const fieldTags = tags
            .filter((t) => t.field === field)
            .sort((a, b) => {
              const countA = tagCounts.get(a.id) ?? 0
              const countB = tagCounts.get(b.id) ?? 0
              return countB - countA
            })

          if (fieldTags.length === 0) return null

          const isOpen = openFields.has(field)

          return (
            <div
              key={field}
              style={{
                background: '#13131b',
                border: '0.5px solid #1e1e2a',
                borderRadius: '8px',
                overflow: 'hidden'
              }}
            >
              {/* Accordion header */}
              <button
                onClick={() => toggleField(field)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#c0c0d8' }}>
                    {label}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      background: '#1e1e2a',
                      color: '#555',
                      padding: '1px 6px',
                      borderRadius: '10px'
                    }}
                  >
                    {fieldTags.length}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '10px',
                    color: '#444',
                    transform: isOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s'
                  }}
                >
                  ▾
                </span>
              </button>

              {/* Tags */}
              {isOpen && (
                <div
                  style={{
                    padding: '0 14px 12px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px'
                  }}
                >
                  {fieldTags.map((tag) => {
                    const count = tagCounts.get(tag.id) ?? 0
                    return (
                      <Badge
                        key={tag.id}
                        variant="outline"
                        onClick={() => onTagSelect(tag)}
                        style={{
                          background: tag.color + '22',
                          color: tag.color,
                          borderColor: tag.color + '44',
                          fontSize: '11px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          padding: '3px 10px',
                          userSelect: 'none',
                          transition: 'all 0.1s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = tag.color + '44'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = tag.color + '22'
                        }}
                      >
                        {tag.value}
                        {count > 0 && (
                          <span
                            style={{
                              marginLeft: '5px',
                              fontSize: '9px',
                              opacity: 0.7
                            }}
                          >
                            {count}
                          </span>
                        )}
                      </Badge>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
