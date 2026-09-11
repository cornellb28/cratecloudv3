import React, { useEffect, useState } from 'react'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { ReconciliationModal } from './ReconciliationModal'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  libraryRoots: LibraryRoot[]
  onRootsChanged: () => void
}

const SERATO_OVERRIDE_KEY = 'serato_library_override'
const SERATO_OVERWRITE_KEY = 'serato_overwrite_existing'

export function SettingsModal({
  open,
  onClose,
  libraryRoots,
  onRootsChanged
}: SettingsModalProps): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [seratoOverride, setSeratoOverride] = useState<string | null>(null)
  const [overwriteExisting, setOverwriteExisting] = useState(true)

  // Loaded once when the modal opens rather than on mount — settings rarely
  // change while it's closed, and this avoids an IPC round trip the app
  // never otherwise needs (nothing else reads these two keys).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      window.api.settings.get(SERATO_OVERRIDE_KEY),
      window.api.settings.get(SERATO_OVERWRITE_KEY)
    ]).then(([override, overwrite]) => {
      if (cancelled) return
      setSeratoOverride(override || null)
      setOverwriteExisting(overwrite !== 'false')
    })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleChooseSeratoFolder(): Promise<void> {
    const folderPath = await window.api.openFolder()
    if (!folderPath) return
    await window.api.settings.set(SERATO_OVERRIDE_KEY, folderPath)
    setSeratoOverride(folderPath)
  }

  async function handleClearSeratoFolder(): Promise<void> {
    await window.api.settings.set(SERATO_OVERRIDE_KEY, '')
    setSeratoOverride(null)
  }

  async function handleToggleOverwrite(): Promise<void> {
    const next = !overwriteExisting
    setOverwriteExisting(next)
    await window.api.settings.set(SERATO_OVERWRITE_KEY, String(next))
  }

  async function handleAddFolder(): Promise<void> {
    const folderPath = await window.api.openFolder()
    if (!folderPath) return

    setAdding(true)
    await window.api.roots.add(folderPath)
    setAdding(false)
    onRootsChanged()
  }

  async function handleRemove(id: number): Promise<void> {
    await window.api.roots.remove(id)
    onRootsChanged()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        style={{
          background: '#13131b',
          border: '0.5px solid #1e1e2a',
          borderRadius: '12px',
          maxWidth: '440px',
          width: '100%',
          color: '#e8e8f0',
          fontFamily: 'inherit',
          padding: '0'
        }}
      >
        <div style={{ padding: '16px', borderBottom: '0.5px solid #1e1e2a' }}>
          <div style={{ fontSize: '15px', fontWeight: 500 }}>Settings</div>
        </div>

        <div style={{ padding: '16px' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: '#444',
              marginBottom: '10px'
            }}
          >
            Library folders
          </div>

          {libraryRoots.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#444', marginBottom: '12px' }}>
              No folders registered yet.
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}
            >
              {libraryRoots.map((root) => (
                <div
                  key={root.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '8px 10px',
                    background: '#1a1a26',
                    border: '0.5px solid #252535',
                    borderRadius: '6px'
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: '#c0c0d8' }}>{root.name}</div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#444',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {root.path}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(root.id)}
                    title="Remove folder"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#555',
                      cursor: 'pointer',
                      fontSize: '13px',
                      flexShrink: 0
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button onClick={handleAddFolder} disabled={adding} variant="outline" size="sm">
            {adding ? 'Adding...' : '+ Add library folder'}
          </Button>
        </div>
        <div style={{ padding: '16px', borderBottom: '0.5px solid #1e1e2a' }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReconcileOpen(true)}
            className="text-xs"
          >
            Review pending changes
          </Button>

          <ReconciliationModal open={reconcileOpen} onClose={() => setReconcileOpen(false)} />
        </div>

        <div style={{ padding: '16px' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: '#444',
              marginBottom: '10px'
            }}
          >
            Serato export
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: '#c0c0d8', marginBottom: '4px' }}>
              Serato library location
            </div>
            <div style={{ fontSize: '10px', color: '#444', marginBottom: '8px' }}>
              {seratoOverride
                ? seratoOverride
                : 'Default — ~/Music/_Serato_ (or the volume root for tracks on another drive)'}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Button
                onClick={() => void handleChooseSeratoFolder()}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                Choose folder…
              </Button>
              {seratoOverride && (
                <Button
                  onClick={() => void handleClearSeratoFolder()}
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  style={{ color: '#555' }}
                >
                  Reset to default
                </Button>
              )}
            </div>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: '#c0c0d8',
              cursor: 'pointer'
            }}
          >
            <div
              onClick={() => void handleToggleOverwrite()}
              style={{
                width: '30px',
                height: '17px',
                borderRadius: '10px',
                background: overwriteExisting ? '#7f77dd' : '#252535',
                position: 'relative',
                flexShrink: 0,
                transition: 'background 0.15s'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: overwriteExisting ? '15px' : '2px',
                  width: '13px',
                  height: '13px',
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.15s'
                }}
              />
            </div>
            Overwrite existing crate of the same name
          </label>
        </div>
      </DialogContent>
    </Dialog>
  )
}
