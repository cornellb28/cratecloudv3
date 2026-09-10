import React from 'react'
import { MosaicArtwork } from './MosaicArtwork'

interface FolderCardProps {
  name: string
  path: string
  trackCount: number
  audioCount?: number
  artworkHashes: (string | null)[]
  onClick: () => void
  // Brief one-shot flash — used for a folder that was just created,
  // imported, or moved into the grid currently being rendered. Plays once;
  // the caller is responsible for clearing it back to false after the
  // animation's duration (see folderHighlight in main.css).
  highlighted?: boolean
}

// TODO: dropping Finder files directly onto a folder card (as opposed to
// opening it and dropping into its content area, which FolderView already
// supports) is out of scope for this pass — see useFileDrop in FolderView.tsx
// for the pattern to reuse if this card grows its own drop target.
export function FolderCard({
  name,
  path,
  trackCount,
  audioCount,
  artworkHashes,
  onClick,
  highlighted
}: FolderCardProps): React.JSX.Element {
  // A folder with nothing in its subtree yet — just created, or a rename
  // target waiting on the identity work to relink its tracks. Shown dimmed
  // rather than hidden (see FolderView's subfolders comment).
  const isEmpty = trackCount === 0

  // audioCount (disk) vs trackCount (imported into the DB) — show both only when they diverge
  const countLabel = isEmpty
    ? 'Empty'
    : audioCount !== undefined && audioCount !== trackCount
      ? `${audioCount} track${audioCount !== 1 ? 's' : ''} · ${trackCount} analyzed`
      : `${trackCount} track${trackCount !== 1 ? 's' : ''}`

  return (
    <div
      onClick={onClick}
      title={path}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        margin: '-8px',
        borderRadius: '10px',
        opacity: isEmpty ? 0.5 : 1,
        transition: 'transform 0.15s, opacity 0.15s',
        animation: highlighted ? 'folderHighlight 1.8s ease-out' : undefined
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {/* Mosaic artwork */}
      <MosaicArtwork artworkHashes={artworkHashes} folderName={name} size={160} borderRadius={8} />

      {/* Folder info */}
      <div>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: '#e0e0f0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: '2px'
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: '11px', color: '#555' }}>{countLabel}</div>
      </div>
    </div>
  )
}
