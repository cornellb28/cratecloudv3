import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLibraryStore } from '../store/useLibraryStore'

const WIDTH = 220
const MAX_HEIGHT = 300
const DEFAULT_CRATE_COLOR = '#7f77dd'

interface CratePickerProps {
  // Bulk-capable — TrackRowMenu passes a single-id array, BulkBar passes the
  // whole selection. A crate checkbox reads as "checked" only when every id
  // here is already a member; toggling always applies to the full set.
  trackIds: number[]
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

// Ported from v2's CratePicker (same checkbox-list + inline "+ New crate"
// UX, which already worked well there) — adapted from single-track to
// bulk-capable, and restyled inline to match v3's dark theme (v2 used CSS
// classes from a global stylesheet v3 doesn't have).
export function CratePicker({
  trackIds,
  anchorRef,
  onClose
}: CratePickerProps): React.JSX.Element | null {
  const {
    crates,
    crateTrackIds,
    upsertCrateLocally,
    addTracksToCrateLocally,
    removeTracksFromCrateLocally
  } = useLibraryStore()
  const ref = useRef<HTMLDivElement>(null)
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null)

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const above = window.innerHeight - rect.bottom < MAX_HEIGHT + 12
    setPos({
      left: Math.min(rect.left, window.innerWidth - WIDTH - 12),
      top: above ? rect.top - 8 : rect.bottom + 8,
      above
    })
  }, [anchorRef])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchorRef.current?.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  const isFullyMember = (crateId: number): boolean => {
    const members = crateTrackIds.get(crateId)
    if (!members) return false
    return trackIds.every((id) => members.has(id))
  }

  async function toggle(crateId: number, currentlyMember: boolean): Promise<void> {
    setPendingIds((s) => new Set(s).add(crateId))
    try {
      if (currentlyMember) {
        const result = await window.api.crates.removeTracks(crateId, trackIds)
        if (result.ok) removeTracksFromCrateLocally(crateId, trackIds)
        else toast.error('Could not remove from crate', { description: result.error })
      } else {
        const result = await window.api.crates.addTracks(crateId, trackIds)
        if (result.ok) addTracksToCrateLocally(crateId, trackIds)
        else toast.error('Could not add to crate', { description: result.error })
      }
    } finally {
      setPendingIds((s) => {
        const next = new Set(s)
        next.delete(crateId)
        return next
      })
    }
  }

  async function handleCreateCrate(): Promise<void> {
    const trimmed = newName.trim()
    if (!trimmed) return
    const result = await window.api.crates.insert(trimmed, null, DEFAULT_CRATE_COLOR)
    if (!result.ok || result.id === undefined) {
      toast.error('Could not create crate', { description: result.error })
      return
    }
    const now = Math.floor(Date.now() / 1000)
    upsertCrateLocally({
      id: result.id,
      name: trimmed,
      color: DEFAULT_CRATE_COLOR,
      parent_crate_id: null,
      created_at: now,
      updated_at: now,
      last_exported_at: null,
      track_count: trackIds.length
    })
    await window.api.crates.addTracks(result.id, trackIds)
    addTracksToCrateLocally(result.id, trackIds)
    setNewName('')
    setCreating(false)
  }

  if (!pos) return null

  // Top-level crates only, alphabetical — nested crates can still receive
  // tracks (open the crate itself and use BulkBar/context menu there);
  // this picker is for quick top-of-mind assignment, not tree navigation.
  const topLevel = crates
    .filter((c) => c.parent_crate_id === null)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: pos.above ? 'translateY(-100%)' : undefined,
        width: WIDTH,
        maxHeight: MAX_HEIGHT,
        background: '#1a1a26',
        border: '0.5px solid #252535',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 200,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'inherit'
      }}
    >
      <div style={{ overflowY: 'auto', padding: '4px 0' }}>
        {topLevel.length === 0 && (
          <div
            style={{ padding: '10px 14px', fontSize: '11px', color: '#444', fontStyle: 'italic' }}
          >
            No crates yet.
          </div>
        )}
        {topLevel.map((c) => {
          const member = isFullyMember(c.id)
          return (
            <label
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '6px 14px',
                fontSize: '12px',
                color: '#c0c0d8',
                cursor: pendingIds.has(c.id) ? 'default' : 'pointer',
                opacity: pendingIds.has(c.id) ? 0.5 : 1
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#252535')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <input
                type="checkbox"
                checked={member}
                disabled={pendingIds.has(c.id)}
                onChange={() => void toggle(c.id, member)}
                style={{ accentColor: '#7f77dd', margin: 0, flexShrink: 0 }}
              />
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: c.color,
                  flexShrink: 0
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {c.name}
              </span>
              <span style={{ fontSize: '10px', color: '#444', flexShrink: 0 }}>
                {c.track_count ?? 0}
              </span>
            </label>
          )
        })}
      </div>

      <div style={{ height: '1px', background: '#252535' }} />

      {creating ? (
        <input
          autoFocus
          value={newName}
          placeholder="Crate name"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleCreateCrate()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setCreating(false)
              setNewName('')
            }
          }}
          onBlur={() => {
            if (!newName.trim()) setCreating(false)
          }}
          style={{
            boxSizing: 'border-box',
            width: `calc(100% - 28px)`,
            margin: '6px 14px',
            background: '#14141c',
            border: '0.5px solid #7f77dd',
            borderRadius: '5px',
            color: '#e8e8f0',
            fontSize: '12px',
            padding: '5px 8px',
            fontFamily: 'inherit',
            outline: 'none'
          }}
        />
      ) : (
        <div
          onClick={() => setCreating(true)}
          style={{
            padding: '8px 14px',
            fontSize: '12px',
            color: '#a09be8',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#252535')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          + New crate
        </div>
      )}
    </div>
  )
}
