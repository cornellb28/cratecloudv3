import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MoreVertical, Library, Trash2, FolderPlus, FolderMinus } from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { usePlayerStore } from '../store/usePlayerStore'
import { DeleteFileConfirmDialog } from './DeleteFileConfirmDialog'
import { CratePicker } from './CratePicker'

interface TrackRowMenuProps {
  track: Track
  // Set when this row is rendered inside that crate's own track list — adds
  // a "Remove from crate" action scoped to just this one crate.
  crateId?: number
}

// Per-row "…" menu: "Remove from CrateCloud" drops the library entry only
// (no confirm — same directness as removing a library root in Settings);
// "Delete from Hard Drive" also trashes the file, so it goes through
// DeleteFileConfirmDialog first since that one can't be undone from here.
export function TrackRowMenu({ track, crateId }: TrackRowMenuProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cratePickerOpen, setCratePickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const removeTrack = useLibraryStore((s) => s.removeTrack)
  const removeTracksFromCrateLocally = useLibraryStore((s) => s.removeTracksFromCrateLocally)

  useEffect(() => {
    if (!menuOpen) return
    function handle(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [menuOpen])

  const trackTitle = track.title ?? track.filename ?? 'this track'

  async function handleRemoveFromCrate(): Promise<void> {
    if (crateId === undefined) return
    const result = await window.api.crates.removeTracks(crateId, [track.id])
    if (result.ok) {
      removeTracksFromCrateLocally(crateId, [track.id])
      toast.success(`Removed "${trackTitle}" from crate`)
    } else {
      toast.error('Could not remove from crate', { description: result.error })
    }
  }

  // Clears playback when the track being removed is the one currently
  // loaded — otherwise the player bar keeps pointing at a filepath that no
  // longer resolves to a library entry (or to a file at all, in the delete
  // case).
  function stopIfCurrent(): void {
    if (usePlayerStore.getState().currentTrack?.id === track.id) {
      usePlayerStore.setState({ currentTrack: null, isPlaying: false })
    }
  }

  async function runRemoval(deleteFile: boolean, successMessage: string): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.db.deleteTrack(track.id, deleteFile)
      if (result.ok) {
        stopIfCurrent()
        removeTrack(track.id)
        toast.success(successMessage)
      } else {
        toast.error(deleteFile ? 'Could not delete file' : 'Could not remove track', {
          description: result.error ?? 'Unknown error'
        })
      }
    } catch (err) {
      toast.error(deleteFile ? 'Could not delete file' : 'Could not remove track', {
        description: (err as Error).message
      })
    }
    setBusy(false)
  }

  return (
    <div ref={menuRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        data-testid={`track-menu-${track.id}`}
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
        title="More options"
        style={{
          border: 'none',
          background: 'none',
          color: '#555',
          cursor: busy ? 'default' : 'pointer',
          padding: '4px',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#252535'
          e.currentTarget.style.color = '#e8e8f0'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none'
          e.currentTarget.style.color = '#555'
        }}
      >
        <MoreVertical size={16} />
      </button>

      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: '210px',
            background: '#1a1a26',
            border: '0.5px solid #252535',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 100,
            overflow: 'hidden'
          }}
        >
          <button
            onClick={() => {
              setMenuOpen(false)
              setCratePickerOpen(true)
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#252535')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <FolderPlus size={14} />
            Add to crate
          </button>
          {crateId !== undefined && (
            <button
              onClick={() => {
                setMenuOpen(false)
                void handleRemoveFromCrate()
              }}
              style={menuItemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#252535')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <FolderMinus size={14} />
              Remove from crate
            </button>
          )}
          <button
            onClick={() => {
              setMenuOpen(false)
              void runRemoval(false, `Removed "${trackTitle}" from CrateCloud`)
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#252535')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Library size={14} />
            Remove from CrateCloud
          </button>
          <button
            onClick={() => {
              setMenuOpen(false)
              setConfirmOpen(true)
            }}
            style={{ ...menuItemStyle, color: '#e08a80' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#252535')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Trash2 size={14} />
            Delete from Hard Drive
          </button>
        </div>
      )}

      {cratePickerOpen && (
        <CratePicker
          trackIds={[track.id]}
          anchorRef={triggerRef}
          onClose={() => setCratePickerOpen(false)}
        />
      )}

      <DeleteFileConfirmDialog
        open={confirmOpen}
        trackTitle={trackTitle}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          void runRemoval(true, `Deleted "${trackTitle}"`)
        }}
      />
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '9px 12px',
  border: 'none',
  background: 'transparent',
  color: '#c0c0d8',
  fontSize: '12px',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 0.1s'
}
