import React, { useState, useRef } from 'react'
import { Button } from '@renderer/components/ui/button'
import { FolderTreeDropdown } from './FolderTreeDropdown'
import { MoveConfirmDialog } from './MoveConfirmDialog'
import { useLibraryStore } from '../store/useLibraryStore'

interface MoveFileButtonProps {
  track: Track
  size?: 'sm' | 'default'
  label?: string
}

export function MoveFileButton({
  track,
  size = 'sm',
  label = 'Move to...'
}: MoveFileButtonProps): React.JSX.Element {
  const { updateTrack } = useLibraryStore()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [destination, setDestination] = useState<{ path: string; name: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Anchor position for the dropdown
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 })

  function openDropdown(): void {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setAnchor({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width
      })
    }
    setDropdownOpen(true)
  }

  async function handleSelect(path: string, name: string): Promise<void> {
    setDropdownOpen(false)
    setDestination({ path, name })

    // Check if DJ wants to skip confirmation
    const skip = await window.api.settings.get('skip_move_confirmation')
    if (skip === 'true') {
      await doMove(path)
      return
    }

    setConfirmOpen(true)
  }

  async function handleConfirm(dontAskAgain: boolean): Promise<void> {
    if (!destination) return
    setConfirmOpen(false)

    if (dontAskAgain) {
      await window.api.settings.set('skip_move_confirmation', 'true')
    }

    await doMove(destination.path)
  }

  async function doMove(targetPath: string): Promise<void> {
    setMoving(true)
    try {
      const result = await window.api.fs.moveFile(track.filepath, targetPath)
      if (result.ok && result.newPath) {
        updateTrack(track.id, { filepath: result.newPath })
      } else {
        console.error('Move failed:', result.error)
      }
    } catch (err) {
      console.error('Move error:', err)
    }
    setMoving(false)
    setDestination(null)
  }

  const trackTitle = track.title ?? track.filename ?? 'this track'

  return (
    <>
      <Button
        ref={buttonRef}
        variant="outline"
        size={size}
        onClick={openDropdown}
        disabled={moving}
        className="w-full justify-start gap-2 text-xs"
      >
        <span>{moving ? '...' : '↗'}</span>
        {moving ? 'Moving...' : label}
      </Button>

      {/* Folder tree dropdown */}
      {dropdownOpen && (
        <FolderTreeDropdown
          anchor={anchor}
          onSelect={handleSelect}
          onClose={() => setDropdownOpen(false)}
        />
      )}

      {/* Confirmation dialog */}
      {destination && (
        <MoveConfirmDialog
          open={confirmOpen}
          trackTitle={trackTitle}
          destination={destination.name}
          onConfirm={handleConfirm}
          onCancel={() => {
            setConfirmOpen(false)
            setDestination(null)
          }}
        />
      )}
    </>
  )
}
