import React from 'react'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'

interface CrossDeviceMoveDialogProps {
  open: boolean
  fileCount: number
  totalMB: number
  onConfirm: () => void
  onCancel: () => void
}

// Shown only when the destination is on a different drive/volume than the
// selected files — a bulk move that falls back to a real copy for every
// file, not the near-instant same-device rename this app usually does.
export function CrossDeviceMoveDialog({
  open,
  fileCount,
  totalMB,
  onConfirm,
  onCancel
}: CrossDeviceMoveDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent
        style={{
          background: '#13131b',
          border: '0.5px solid #1e1e2a',
          borderRadius: '12px',
          maxWidth: '380px',
          width: '100%',
          color: '#e8e8f0',
          fontFamily: 'inherit',
          padding: '20px'
        }}
      >
        <div style={{ fontSize: '28px', marginBottom: '12px', textAlign: 'center' }}>↗</div>

        <div
          style={{ fontSize: '14px', fontWeight: 500, textAlign: 'center', marginBottom: '8px' }}
        >
          Move across drives?
        </div>

        <div
          style={{
            fontSize: '12px',
            color: '#555',
            textAlign: 'center',
            marginBottom: '20px',
            lineHeight: 1.5
          }}
        >
          This will copy{' '}
          <span style={{ color: '#a09be8', fontWeight: 500 }}>
            {fileCount} file{fileCount !== 1 ? 's' : ''}
          </span>{' '}
          (~{totalMB.toFixed(0)} MB) across drives. This can take a while for large files.
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="flex-1 text-xs"
            style={{ color: '#555' }}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onConfirm}
            className="flex-1 text-xs"
            style={{ borderColor: '#7f77dd', color: '#a09be8' }}
          >
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
