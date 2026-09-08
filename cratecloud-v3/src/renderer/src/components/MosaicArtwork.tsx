import React from 'react'

interface MosaicArtworkProps {
  artworkPaths: (string | null)[]
  folderName: string
  size?: number
  borderRadius?: number
}

// Generates a consistent color from a string — same as genre colors
function folderColor(name: string): string {
  const colors = [
    '#7f77dd', '#1d9e75', '#d85a30',
    '#378add', '#ba7517', '#d4537e',
    '#534ab7', '#0f6e56', '#993c1d',
  ]
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % colors.length
  }
  return colors[Math.abs(hash)]
}

export function MosaicArtwork({
  artworkPaths,
  folderName,
  size = 200,
  borderRadius = 8,
}: MosaicArtworkProps): React.JSX.Element {

  // Filter to real artwork paths only
  const realArtwork = artworkPaths.filter(Boolean).slice(0, 4) as string[]

  const baseColor = folderColor(folderName)

  // ── No artwork — Option C: generated color ────────────

  if (realArtwork.length === 0) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        // Option C — gradient using folder's generated color
        background: `linear-gradient(135deg, ${baseColor}cc 0%, ${baseColor}44 100%)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
      }}>
        {/* Large folder icon */}
        <span style={{ fontSize: size * 0.25, lineHeight: 1 }}>⊟</span>
        {/* Folder name */}
        <span style={{
          fontSize: Math.max(10, size * 0.08),
          fontWeight: 500,
          color: '#fff',
          textAlign: 'center',
          padding: '0 12px',
          lineHeight: 1.3,
          wordBreak: 'break-word',
          maxWidth: '90%',
        }}>
          {folderName}
        </span>
      </div>
    )
  }

  // ── 1 artwork — full size ─────────────────────────────

  if (realArtwork.length === 1) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius,
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <img
          src={`artwork://${realArtwork[0]}`}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {/* Option A — folder name overlay on single image */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '24px 12px 10px',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
          color: '#fff',
          fontSize: Math.max(10, size * 0.08),
          fontWeight: 500,
        }}>
          {folderName}
        </div>
      </div>
    )
  }

  // ── 2 artworks — side by side ─────────────────────────

  if (realArtwork.length === 2) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius,
        flexShrink: 0,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2px',
        background: '#1e1e2a',
      }}>
        {realArtwork.map((path, i) => (
          <img
            key={i}
            src={`artwork://${path}`}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ))}
      </div>
    )
  }

  // ── 3 artworks — left full + right split ──────────────

  if (realArtwork.length === 3) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius,
        flexShrink: 0,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: '2px',
        background: '#1e1e2a',
      }}>
        <img
          src={`artwork://${realArtwork[0]}`}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            gridRow: '1 / 3',
          }}
        />
        <img
          src={`artwork://${realArtwork[1]}`}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <img
          src={`artwork://${realArtwork[2]}`}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    )
  }

  // ── 4 artworks — 2x2 mosaic ───────────────────────────

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius,
      flexShrink: 0,
      overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: '2px',
      background: '#1e1e2a',
    }}>
      {realArtwork.slice(0, 4).map((path, i) => (
        <img
          key={i}
          src={`artwork://${path}`}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ))}
    </div>
  )
}
