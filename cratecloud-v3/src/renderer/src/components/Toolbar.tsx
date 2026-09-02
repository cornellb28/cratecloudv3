import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

interface ToolbarProps {
  onImport: () => void
  activeView: 'library' | 'board'
}

export function Toolbar({ onImport, activeView }: ToolbarProps): React.JSX.Element {
  const { isAnalyzing, tracks, searchQuery, setSearchQuery } = useLibraryStore()

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
      {activeView === 'library' && (
        <div className="relative flex-1">
          <Input
            type="text"
            placeholder="Search title, artist, BPM, key..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#1a1a26] border-[#252535] text-[#e8e8f0] placeholder:text-[#444] h-8 text-xs font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#a09be8] text-sm"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Board view label instead of search */}
      {activeView === 'board' && (
        <span className="text-xs text-muted-foreground flex-1">
          Drag tracks between columns to organize your workflow
        </span>
      )}

      <span style={{ color: '#444', fontSize: '12px', marginLeft: 'auto' }}>
        {tracks.length} tracks
      </span>
    </div>
  )
}
