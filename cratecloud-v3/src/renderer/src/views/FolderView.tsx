import React, { useState, useEffect } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { FolderCard } from '../components/FolderCard'
import { MosaicArtwork } from '../components/MosaicArtwork'
import { TrackRow } from '../components/TrackRow'
import { TrackCard } from '../components/TrackCard'
import { BulkBar } from '../components/BulkBar'
import { Button } from '@renderer/components/ui/button'

interface FolderViewProps {
  libraryRoots: LibraryRoot[] // all registered library roots
}

export function FolderView({ libraryRoots }: FolderViewProps): React.JSX.Element {
  const { tracks, displayMode, isAnalyzing, setAnalyzing, setTracks } = useLibraryStore()

  // Navigation stack — array of folder paths. Empty = top-level root picker.
  const [navStack, setNavStack] = useState<string[]>([])
  const [items, setItems] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const currentPath = navStack.length > 0 ? navStack[navStack.length - 1] : null

  // TEMP DEBUG — remove after diagnosing folder/track path mismatch
  useEffect(() => {
    if (currentPath === null) return
    console.log('[FolderView debug] currentPath:', currentPath)
    console.log(
      '[FolderView debug] first 5 track filepaths:',
      tracks.slice(0, 5).map((t) => t.filepath)
    )
    console.log(
      '[FolderView debug] tracks starting with currentPath:',
      tracks.filter((t) => t.filepath.startsWith(currentPath)).length
    )
  }, [currentPath, tracks])

  // Load folder contents when path changes
  useEffect(() => {
    if (currentPath === null) return
    const path = currentPath
    async function load(): Promise<void> {
      setLoading(true)
      const result = await window.api.fs.readFolder(path)
      if (result.ok && result.items) {
        setItems(result.items)
      }
      setLoading(false)
    }
    load()
  }, [currentPath])

  // Get up to 4 artwork paths from tracks in a folder
  function getArtworkForFolder(folderPath: string): (string | null)[] {
    return tracks
      .filter((t) => t.filepath.startsWith(folderPath))
      .filter((t) => t.artwork_path)
      .slice(0, 4)
      .map((t) => t.artwork_path)
  }

  // Track count for a subfolder
  function getTrackCount(folderPath: string): number {
    return tracks.filter((t) => t.filepath.startsWith(folderPath)).length
  }

  // Navigate into a subfolder
  function navigateInto(path: string): void {
    setNavStack((prev) => [...prev, path])
    setSelectedIds(new Set())
  }

  // Import everything under the folder currently being browsed — recurses into
  // every subfolder, same scanner the Toolbar's "+ Import folder" button uses
  async function handleImportThisFolder(folderPath: string): Promise<void> {
    setAnalyzing(true)
    const result = await window.api.importFolder(folderPath)
    if (result.ok) {
      const all = await window.api.db.allTracks()
      setTracks(all)
    }
    setAnalyzing(false)
  }

  // Top level — no folder selected yet — show all registered library roots
  if (currentPath === null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <h2
            style={{
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              color: '#444',
              marginBottom: '14px'
            }}
          >
            Folders
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '16px'
            }}
          >
            {libraryRoots.map((root) => (
              <FolderCard
                key={root.id}
                name={root.name}
                path={root.path}
                trackCount={getTrackCount(root.path)}
                artworkPaths={getArtworkForFolder(root.path)}
                onClick={() => navigateInto(root.path)}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Tracks directly in the current folder
  const folderTracks = tracks.filter(
    (t) =>
      t.filepath.startsWith(currentPath) && !t.filepath.slice(currentPath.length + 1).includes('/')
  )

  // Subfolders
  const subfolders = items.filter((i) => i.isDirectory)

  function toggleSelect(id: number): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Breadcrumb segments
  const breadcrumbs = navStack.map((path, i) => ({
    path,
    name:
      i === 0
        ? (path.split('/').filter(Boolean).pop() ?? 'Library')
        : (path.split('/').filter(Boolean).pop() ?? path)
  }))

  // Hero artwork — 4 from current folder recursively
  const heroArtwork = getArtworkForFolder(currentPath)
  const folderName = currentPath.split('/').filter(Boolean).pop() ?? 'Library'
  const totalTracks = getTrackCount(currentPath)

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#333'
        }}
      >
        Loading...
      </div>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* ── Breadcrumb bar ──────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: '#13131b',
          padding: '8px 24px',
          borderBottom: '0.5px solid #1e1e2a',
          flexShrink: 0
        }}
      >
        {/* Back button — one level up, hidden at the root of this library folder */}
        {navStack.length > 1 && (
          <button
            onClick={() => setNavStack(navStack.slice(0, -1))}
            title="Back"
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: '13px',
              cursor: 'pointer',
              padding: '2px 4px',
              marginRight: '4px',
              lineHeight: 1,
              fontFamily: 'inherit'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e8f0')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
          >
            ←
          </button>
        )}

        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1
          return (
            <React.Fragment key={crumb.path}>
              {isLast ? (
                <span style={{ color: '#e8e8f0', fontSize: '12px', fontWeight: 500 }}>
                  {crumb.name}
                </span>
              ) : (
                <button
                  onClick={() => setNavStack(navStack.slice(0, i + 1))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#555',
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'inherit',
                    fontWeight: 400,
                    textDecoration: 'none'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                >
                  {crumb.name}
                </button>
              )}
              {!isLast && <span style={{ color: '#333', fontSize: '11px' }}>›</span>}
            </React.Fragment>
          )
        })}
      </div>

      {/* ── Hero section ──────────────────────────── */}
      <div
        style={{
          padding: '24px 24px 20px',
          background: 'linear-gradient(180deg, #1a1a26 0%, #13131b 100%)',
          flexShrink: 0
        }}
      >
        {/* Hero content */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
          {/* Mosaic artwork — large */}
          <MosaicArtwork
            artworkPaths={heroArtwork}
            folderName={folderName}
            size={140}
            borderRadius={8}
          />

          {/* Folder info */}
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                color: '#555',
                marginBottom: '6px'
              }}
            >
              Folder
            </div>
            <h1
              style={{
                fontSize: '28px',
                fontWeight: 500,
                color: '#e8e8f0',
                marginBottom: '8px',
                lineHeight: 1.2
              }}
            >
              {folderName}
            </h1>
            <div style={{ fontSize: '12px', color: '#555', marginBottom: '10px' }}>
              {totalTracks} track{totalTracks !== 1 ? 's' : ''}
              {subfolders.length > 0 && (
                <span>
                  {' '}
                  · {subfolders.length} folder{subfolders.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <Button
              onClick={() => handleImportThisFolder(currentPath)}
              disabled={isAnalyzing}
              variant="outline"
              size="sm"
            >
              {isAnalyzing ? 'Importing...' : '+ Import this folder'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Scrollable content ─────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Subfolders grid */}
        {subfolders.length > 0 && (
          <div style={{ padding: '20px 24px' }}>
            <h2
              style={{
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                color: '#444',
                marginBottom: '14px'
              }}
            >
              Folders
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '16px'
              }}
            >
              {subfolders.map((folder) => (
                <FolderCard
                  key={folder.path}
                  name={folder.name}
                  path={folder.path}
                  trackCount={getTrackCount(folder.path)}
                  audioCount={folder.audioCount}
                  artworkPaths={getArtworkForFolder(folder.path)}
                  onClick={() => navigateInto(folder.path)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Tracks in this folder */}
        {folderTracks.length > 0 && (
          <div style={{ padding: subfolders.length > 0 ? '0 24px 24px' : '20px 24px 24px' }}>
            {subfolders.length > 0 && (
              <h2
                style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  color: '#444',
                  marginBottom: '14px'
                }}
              >
                Tracks in this folder
              </h2>
            )}

            {/* BulkBar */}
            <BulkBar
              selectedIds={selectedIds}
              onClearSelect={() => setSelectedIds(new Set())}
              onSelectAll={() => setSelectedIds(new Set(folderTracks.map((t) => t.id)))}
              totalCount={folderTracks.length}
            />

            {/* Track list or grid */}
            {displayMode === 'list' ? (
              <div>
                {folderTracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    isSelected={selectedIds.has(track.id)}
                    onSelected={toggleSelect}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '10px'
                }}
              >
                {folderTracks.map((track) => (
                  <TrackCard
                    key={track.id}
                    track={track}
                    isSelected={selectedIds.has(track.id)}
                    onSelect={toggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty folder */}
        {subfolders.length === 0 && folderTracks.length === 0 && (
          <div
            style={{
              padding: '48px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: '#333'
            }}
          >
            <span style={{ fontSize: '32px' }}>⊟</span>
            <div style={{ fontSize: '14px' }}>This folder is empty</div>
            <div style={{ fontSize: '12px', color: '#2a2a2a' }}>
              Import audio files to see them here
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
