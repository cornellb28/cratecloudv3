import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Button } from '../components/ui/button'

interface ToolbarProps {
  onImport: () => void
}

export function Toolbar({ onImport }: ToolbarProps): React.JSX.Element {
  const { isAnalyzing, tracks } = useLibraryStore()

  return (
    <div
      style={{
        background: '#13131b',
        borderBottom: '0.5px solid #1e1e2a',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0
      }}>
      <Button
        onClick={onImport}
        disabled={isAnalyzing}
        variant="outline"
        size="sm"
      >
        {isAnalyzing ? 'Importing...' : '+ Import folder'}
      </Button>

      <span style={{ color: '#444', fontSize: '12px', marginLeft: 'auto' }}>
        {tracks.length} tracks
      </span>
    </div>
  )
}
