import React, { useState } from 'react'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { ReconciliationModal } from './ReconciliationModal'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  libraryRoots: LibraryRoot[]
  onRootsChanged: () => void
}

export function SettingsModal({
  open,
  onClose,
  libraryRoots,
  onRootsChanged
}: SettingsModalProps): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [reconcileOpen, setReconcileOpen] = useState(false)

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

          <ReconciliationModal open={reconcileOpen} onClose={() => setReconcileOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
