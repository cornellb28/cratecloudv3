import React from 'react'
import { MosaicArtwork } from './MosaicArtwork'

interface FolderCardProps {
  name: string
  path: string
  trackCount: number
  artworkPaths: (string | null)[]
  onClick: () => void
}

export function FolderCard({
  name,
  path,
  trackCount,
  artworkPaths,
  onClick,
}: FolderCardProps): React.JSX.Element {
  return (
    <div
      onClick={onClick}
      title={path}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        transition: 'transform 0.15s',
      }}
      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
    >
      {/* Mosaic artwork */}
      <MosaicArtwork
        artworkPaths={artworkPaths}
        folderName={name}
        size={160}
        borderRadius={8}
      />

      {/* Folder info */}
      <div>
        <div style={{
          fontSize: '13px',
          fontWeight: 500,
          color: '#e0e0f0',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginBottom: '2px',
        }}>
          {name}
        </div>
        <div style={{ fontSize: '11px', color: '#555' }}>
          {trackCount} track{trackCount !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  )
}
