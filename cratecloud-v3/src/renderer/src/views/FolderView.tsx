import React, { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useLibraryStore } from '../store/useLibraryStore'
import { FolderCard } from '../components/FolderCard'
import { MosaicArtwork } from '../components/MosaicArtwork'
import { TrackRow } from '../components/TrackRow'
import { TrackCard } from '../components/TrackCard'
import { BulkBar } from '../components/BulkBar'
import { Button } from '@renderer/components/ui/button'
import { useFileDrop } from '../hooks/useFileDrop'
import { MoveConfirmDialog } from '../components/MoveConfirmDialog'

// Shared with MoveFileButton's single-track "Move to..." confirmation —
// dismissing one dismisses both, they're the same underlying concern.
const MOVE_CONFIRM_SETTING_KEY = 'skip_move_confirmation'

interface FolderViewProps {
  libraryRoots: LibraryRoot[] // all registered library roots
}

export function FolderView({ libraryRoots }: FolderViewProps): React.JSX.Element {
  // `folders`/`folderCounts` live in the shared store, populated once at
  // startup and kept fresh by App.tsx's single debounced onFoldersChanged
  // subscription — this view just reads them, it doesn't fetch its own copy.
  const {
    tracks,
    displayMode,
    isAnalyzing,
    setAnalyzing,
    setTracks,
    folders,
    folderCounts,
    upsertJob
  } = useLibraryStore()

  // Navigation stack — array of folder ids (from the `folders` table). Empty
  // = top-level root picker.
  const [navStack, setNavStack] = useState<number[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // "New folder" inline input, scoped to the currently viewed folder
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  // Armed when a Finder drop needs the "move, not copy" confirmation —
  // holds everything performMove needs once the DJ confirms.
  const [moveConfirm, setMoveConfirm] = useState<{
    accepted: { path: string; kind: 'dir' | 'audio' }[]
    folder: FolderRow
  } | null>(null)

  const currentFolderId = navStack.length > 0 ? navStack[navStack.length - 1] : null

  // `folders` mirrors the real directory tree (populated at import time) and
  // `folderCounts` is one GROUP BY query — everything else (recursive counts,
  // "hide empty folders", artwork sampling) is rolled up from these plus the
  // already-loaded `tracks` array, in memory, instead of a query per folder
  // card.
  const foldersById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])

  const childrenByParent = useMemo(() => {
    const map = new Map<number | null, FolderRow[]>()
    for (const f of folders) {
      const key = f.parent_folder_id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(f)
    }
    return map
  }, [folders])

  const directCountByFolder = useMemo(
    () => new Map(folderCounts.map((c) => [c.folder_id, c.count])),
    [folderCounts]
  )

  // Recursive track count per folder — own direct count plus every
  // descendant's, memoized per folders/counts change so a grid of N folder
  // cards costs one pass over `folders`, not N queries.
  const recursiveCountByFolder = useMemo(() => {
    const cache = new Map<number, number>()
    function compute(id: number): number {
      const cached = cache.get(id)
      if (cached !== undefined) return cached
      let total = directCountByFolder.get(id) ?? 0
      for (const child of childrenByParent.get(id) ?? []) {
        total += compute(child.id)
      }
      cache.set(id, total)
      return total
    }
    for (const f of folders) compute(f.id)
    return cache
  }, [folders, directCountByFolder, childrenByParent])

  // Every folder id in a folder's own subtree (including itself) — used to
  // sample artwork recursively without a per-card query.
  const descendantIdsByFolder = useMemo(() => {
    const cache = new Map<number, Set<number>>()
    function compute(id: number): Set<number> {
      const cached = cache.get(id)
      if (cached) return cached
      const set = new Set<number>([id])
      for (const child of childrenByParent.get(id) ?? []) {
        for (const d of compute(child.id)) set.add(d)
      }
      cache.set(id, set)
      return set
    }
    for (const f of folders) compute(f.id)
    return cache
  }, [folders, childrenByParent])

  // A library root's own folder row (parent_folder_id NULL, relative_path
  // "") — created by ensureFolderTree the first time that root is imported.
  const rootFolderIdByLibraryRootId = useMemo(() => {
    const map = new Map<number, number>()
    for (const f of folders) {
      if (f.parent_folder_id === null && f.root_folder_id !== null) {
        map.set(f.root_folder_id, f.id)
      }
    }
    return map
  }, [folders])

  function getTrackCount(folderId: number): number {
    return recursiveCountByFolder.get(folderId) ?? 0
  }

  function getArtworkForFolder(folderId: number): (string | null)[] {
    const ids = descendantIdsByFolder.get(folderId) ?? new Set([folderId])
    return tracks
      .filter((t) => t.folder_id !== null && ids.has(t.folder_id))
      .filter((t) => t.artwork_hash)
      .slice(0, 4)
      .map((t) => t.artwork_hash)
  }

  // Navigate into a subfolder
  function navigateInto(folderId: number): void {
    setNavStack((prev) => [...prev, folderId])
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

  // Create a subfolder of the folder currently being browsed. fs:create-folder
  // already does mkdir + ensureFolderTree + folders:changed — App.tsx's
  // debounced onFoldersChanged subscription refreshes the shared `folders`
  // slice on its own, so the only thing this needs to do afterward is
  // navigate; the new row shows up in the store a moment later on its own.
  async function handleCreateFolder(parentPath: string): Promise<void> {
    const name = newFolderName.trim()
    if (!name) return
    if (name.includes('/') || name.includes('\\')) {
      toast.error('Could not create folder', { description: 'Name cannot contain slashes' })
      return
    }

    setCreating(true)
    try {
      const result = await window.api.fs.createFolder(parentPath, name)
      if (result.ok && result.path) {
        setCreatingFolder(false)
        setNewFolderName('')
        if (result.folderId == null) {
          toast.warning(`Created "${name}"`, { description: result.reason })
        } else {
          navigateInto(result.folderId)
        }
      } else {
        toast.error('Could not create folder', { description: result.error ?? 'Unknown error' })
      }
    } catch (err) {
      toast.error('Could not create folder', { description: (err as Error).message })
    }
    setCreating(false)
  }

  // Actually runs the move — either straight from handleDropIntoFolder (the
  // "don't ask again" setting is on) or from the confirm dialog's onConfirm.
  // deleteSource: true is the only difference from the old copy-in-place
  // behavior — same job, same never-overwrite/skip-and-report semantics,
  // just relocating instead of duplicating (see copyOneFileIntoFolder).
  async function performMove(
    accepted: { path: string; kind: 'dir' | 'audio' }[],
    folder: FolderRow
  ): Promise<void> {
    if (!folder.path) return
    const sourcePaths = accepted.map((c) => c.path)

    const { jobId } = await window.api.fs.copyIntoFolder({
      sourcePaths,
      destAbsolutePath: folder.path,
      currentFolderPath: folder.path,
      deleteSource: true
    })
    upsertJob({
      type: 'copy',
      jobId,
      phase: 'running',
      done: 0,
      total: sourcePaths.length,
      currentFile: '',
      bytesCopied: 0,
      totalBytes: 0,
      failed: [],
      deleteSource: true
    })
  }

  // Drag-and-drop from Finder into the folder currently being browsed
  // relocates the dropped paths — see performMove. Looks up the folder by
  // id rather than closing over `currentFolder` (defined further down,
  // after this function — but this hook has to be called before either
  // early return below, so it can't depend on anything defined after them).
  async function handleDropIntoFolder(paths: string[]): Promise<void> {
    const folder = currentFolderId !== null ? foldersById.get(currentFolderId) : undefined
    if (!folder?.path) return

    const classified = await window.api.fs.classifyPaths(paths)
    const accepted = classified.filter(
      (c): c is { path: string; kind: 'dir' | 'audio' } => c.kind === 'dir' || c.kind === 'audio'
    )
    const skipped = classified.filter((c) => c.kind === 'other').map((c) => c.path)

    if (skipped.length > 0) {
      toast.warning(
        `Skipped ${skipped.length} unsupported file${skipped.length !== 1 ? 's' : ''}`,
        { description: skipped.map((p) => p.split('/').pop()).join(', ') }
      )
    }
    if (accepted.length === 0) return

    const dismissed = await window.api.settings.get(MOVE_CONFIRM_SETTING_KEY)
    if (dismissed === 'true') {
      await performMove(accepted, folder)
    } else {
      setMoveConfirm({ accepted, folder })
    }
  }

  // MoveConfirmDialog's onConfirm — persists the shared skip-confirmation
  // setting first (if checked) so a page reload isn't needed for it to
  // take effect on the very next drop, then runs the move that was pending.
  async function confirmMove(dontAskAgain: boolean): Promise<void> {
    const pending = moveConfirm
    setMoveConfirm(null)
    if (!pending) return
    if (dontAskAgain) {
      await window.api.settings.set(MOVE_CONFIRM_SETTING_KEY, 'true')
    }
    await performMove(pending.accepted, pending.folder)
  }

  const currentFolderForDrop = currentFolderId !== null ? foldersById.get(currentFolderId) : undefined
  const { isDragging: isDraggingFiles, dropHandlers: folderDropHandlers } = useFileDrop({
    onDrop: handleDropIntoFolder,
    accept: !!currentFolderForDrop?.path
  })

  // Top level — no folder selected yet — show all registered library roots
  if (currentFolderId === null) {
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
            {libraryRoots.map((root) => {
              const rootFolderId = rootFolderIdByLibraryRootId.get(root.id)
              // Briefly undefined right after a root is registered — its
              // own folder row is created as soon as the scan starts, but
              // there's a moment before that where the renderer already
              // has the root but folders:tree doesn't yet. Dim + non-click
              // instead of a silent no-op.
              const pending = rootFolderId === undefined
              return (
                <div
                  key={root.id}
                  style={pending ? { opacity: 0.5, cursor: 'default' } : undefined}
                  title={pending ? 'Scanning…' : undefined}
                >
                  <FolderCard
                    name={root.name}
                    path={root.path}
                    trackCount={pending ? 0 : getTrackCount(rootFolderId)}
                    artworkHashes={pending ? [] : getArtworkForFolder(rootFolderId)}
                    onClick={() => {
                      if (!pending) navigateInto(rootFolderId)
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const currentFolder = foldersById.get(currentFolderId)

  if (!currentFolder) {
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

  // Tracks directly in the current folder
  const folderTracks = tracks.filter((t) => t.folder_id === currentFolderId)

  // Subfolders — hide ones with no audio anywhere in their subtree, same as
  // the old live-disk listing did
  const subfolders = (childrenByParent.get(currentFolderId) ?? []).filter(
    (f) => getTrackCount(f.id) > 0
  )

  function toggleSelect(id: number): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Breadcrumb segments
  const breadcrumbs = navStack.map((id) => ({
    id,
    name: foldersById.get(id)?.name ?? '?'
  }))

  // Hero artwork — 4 from current folder recursively
  const heroArtwork = getArtworkForFolder(currentFolderId)
  const folderName = currentFolder.name
  const totalTracks = getTrackCount(currentFolderId)

  return (
    <div
      {...folderDropHandlers}
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
            <React.Fragment key={crumb.id}>
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
          background: isDraggingFiles
            ? 'linear-gradient(180deg, #241f3d 0%, #1a1626 100%)'
            : 'linear-gradient(180deg, #1a1a26 0%, #13131b 100%)',
          borderBottom: isDraggingFiles ? '2px dashed #7f77dd' : '2px dashed transparent',
          flexShrink: 0,
          transition: 'background 0.15s, border-color 0.15s'
        }}
      >
        {/* Hero content */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
          {/* Mosaic artwork — large */}
          <MosaicArtwork
            artworkHashes={heroArtwork}
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
                color: isDraggingFiles ? '#a09be8' : '#555',
                marginBottom: '6px'
              }}
            >
              {isDraggingFiles ? `Move to ${folderName}` : 'Folder'}
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
            {currentFolder.path && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  onClick={() => handleImportThisFolder(currentFolder.path as string)}
                  disabled={isAnalyzing}
                  variant="outline"
                  size="sm"
                >
                  {isAnalyzing ? 'Scanning...' : '↺ Re-scan this folder'}
                </Button>

                {creatingFolder ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      autoFocus
                      value={newFolderName}
                      disabled={creating}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateFolder(currentFolder.path as string)
                        if (e.key === 'Escape') {
                          setCreatingFolder(false)
                          setNewFolderName('')
                        }
                      }}
                      placeholder="Folder name"
                      style={{
                        background: '#0e0e12',
                        border: '0.5px solid #333',
                        borderRadius: '4px',
                        color: '#e8e8f0',
                        fontSize: '12px',
                        padding: '5px 8px',
                        fontFamily: 'inherit',
                        width: '140px'
                      }}
                    />
                    <span
                      onClick={() => void handleCreateFolder(currentFolder.path as string)}
                      style={{
                        fontSize: '13px',
                        color: '#1d9e75',
                        cursor: 'pointer',
                        padding: '0 2px'
                      }}
                    >
                      ✓
                    </span>
                    <span
                      onClick={() => {
                        setCreatingFolder(false)
                        setNewFolderName('')
                      }}
                      style={{
                        fontSize: '13px',
                        color: '#555',
                        cursor: 'pointer',
                        padding: '0 2px'
                      }}
                    >
                      ×
                    </span>
                  </div>
                ) : (
                  <Button onClick={() => setCreatingFolder(true)} variant="outline" size="sm">
                    + New folder
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Scrollable content ─────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          outline: isDraggingFiles ? '2px dashed #7f77dd' : 'none',
          outlineOffset: '-2px'
        }}
      >
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
                  key={folder.id}
                  name={folder.name}
                  path={folder.path ?? folder.name}
                  trackCount={getTrackCount(folder.id)}
                  artworkHashes={getArtworkForFolder(folder.id)}
                  onClick={() => navigateInto(folder.id)}
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

      {moveConfirm && (
        <MoveConfirmDialog
          open
          title={`Move ${moveConfirm.accepted.length} file${
            moveConfirm.accepted.length !== 1 ? 's' : ''
          } into ${moveConfirm.folder.name}?`}
          description="The originals will be moved, not copied."
          onConfirm={(dontAskAgain) => void confirmMove(dontAskAgain)}
          onCancel={() => setMoveConfirm(null)}
        />
      )}
    </div>
  )
}
