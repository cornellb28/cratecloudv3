import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'

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
      <button onClick={onImport} disabled={isAnalyzing} style={{ padding: '6px 14px' }}>
        {isAnalyzing ? 'Importing...' : '+ Import folder'}
      </button>

      <span style={{ color: '#444', fontSize: '12px', marginLeft: 'auto' }}>
        {tracks.length} tracks
      </span>
    </div>
  )
}
