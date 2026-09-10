import React, { useState, useRef } from 'react'
import { toast } from 'sonner'
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
  const { setTracks } = useLibraryStore()
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
      await doMove(path, name)
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

    await doMove(destination.path, destination.name)
  }

  async function doMove(targetPath: string, targetName: string): Promise<void> {
    setMoving(true)

    // toast.promise drives the visible progress: a loading toast the
    // instant the move starts, morphing into success/error once
    // window.api.fs.moveFile resolves — it's what stays visible even if
    // this button's own panel (Inspector/BoardCardModal) closes mid-move.
    const movePromise = (async (): Promise<{
      name: string
      underRoot?: boolean
      diagnostics?: { crossDevice: boolean; fileSizeMB: number; durationMs: number }
    }> => {
      const result = await window.api.fs.moveFile(track.filepath, targetPath)
      if (!result.ok || !result.newPath) {
        throw new Error(result.error ?? 'Unknown error')
      }
      // folder_id changes with the path (it mirrors disk location), so
      // refetch rather than patch just filepath in place.
      const all = await window.api.db.allTracks()
      setTracks(all)
      // Temporary diagnostic — see moveFileToFolder's comment in main/index.ts.
      if (result.diagnostics) console.log('[move]', result.diagnostics)
      return { name: targetName, underRoot: result.underRoot, diagnostics: result.diagnostics }
    })()

    toast.promise(movePromise, {
      loading: `Moving ${trackTitle}...`,
      success: ({ name, diagnostics }) => ({
        message: `Moved ${trackTitle} to ${name}`,
        description: diagnostics
          ? diagnostics.crossDevice
            ? `Cross-device copy — ${diagnostics.fileSizeMB}MB in ${(diagnostics.durationMs / 1000).toFixed(1)}s`
            : `Same-device rename — ${diagnostics.durationMs}ms`
          : undefined
      }),
      error: (err) => `Could not move the file: ${(err as Error).message}`
    })

    try {
      const { underRoot } = await movePromise
      if (underRoot === false) {
        toast.warning('This folder isn\'t part of a tracked library', {
          description: 'The track won\'t show up under any folder until this location is imported.'
        })
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
