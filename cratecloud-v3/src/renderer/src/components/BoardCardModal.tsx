import React, { useState, useRef } from 'react'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Badge } from '@renderer/components/ui/badge'
import { Slider } from '@renderer/components/ui/slider'
import { Separator } from '@renderer/components/ui/separator'
import { TagInput } from './TagInput'
import { useLibraryStore } from '../store/useLibraryStore'

interface BoardCardModalProps {
  track: Track
  open: boolean
  onClose: () => void
}

const BOARD_COLUMNS = [
  { id: 1, name: 'Untagged', color: '#888780' },
  { id: 2, name: 'Tagged', color: '#378ADD' },
  { id: 3, name: 'Crate ready', color: '#1D9E75' },
  { id: 4, name: 'Gig ready', color: '#7F77DD' }
]

export function BoardCardModal({ track, open, onClose }: BoardCardModalProps): React.JSX.Element {
  const { updateTrack, quickTags: allQuickTags } = useLibraryStore()
  const [metaOpen, setMetaOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Quick tags — comment field only
  const quickTags = allQuickTags.filter((t) => t.field === 'comment').slice(0, 6)

  // Applied comment tags
  const { trackTags, setTrackTags } = useLibraryStore()
  const appliedTags = trackTags.get(track.id) ?? []
  const commentTagIds = new Set(appliedTags.filter((t) => t.field === 'comment').map((t) => t.id))

  // Stop audio when the dialog is dismissed
  function handleOpenChange(next: boolean): void {
    if (!next) {
      audioRef.current?.pause()
      setIsPlaying(false)
    }
    onClose()
  }

  // Tab through inputs quickly
  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    field: string,
    value: string
  ): void {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      saveField(field, value)
      // Focus next input
      const inputs = document.querySelectorAll<HTMLInputElement>('[data-board-field]')
      const current = Array.from(inputs).findIndex((el) => el.dataset.boardField === field)
      inputs[current + 1]?.focus()
    }
  }

  async function saveField(field: string, value: string): Promise<void> {
    updateTrack(track.id, { [field]: value || null })
    await window.api.db.updateTrackMeta({
      id: track.id,
      title: track.title,
      artist: track.artist,
      genre: track.genre,
      bpm: track.bpm,
      key_camelot: track.key_camelot,
      energy: track.energy,
      comment: track.comment,
      artwork_path: track.artwork_path,
      needs_sync: track.needs_sync,
      pending_changes: track.pending_changes,
      [field]: field === 'bpm' ? parseFloat(value) || null : value || null
    })
  }

  async function moveToColumn(boardId: number): Promise<void> {
    updateTrack(track.id, { board_id: boardId })
    await window.api.db.updateBoardId(track.id, boardId)
  }

  async function toggleQuickTag(tag: Tag): Promise<void> {
    const isApplied = commentTagIds.has(tag.id)
    if (isApplied) {
      const updated = appliedTags.filter((t) => t.id !== tag.id)
      setTrackTags(track.id, updated)
      await window.api.tags.remove(track.id, tag.id)
    } else {
      const updated = [...appliedTags, tag]
      setTrackTags(track.id, updated)
      await window.api.tags.apply(track.id, tag.id)
    }
  }

  async function togglePlay(): Promise<void> {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.onended = () => setIsPlaying(false)
    }
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.src = `artwork://${track.filepath}`
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  const artworkUrl = track.artwork_path ? `artwork://${track.artwork_path}` : null
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        style={{
          background: '#13131b',
          border: '0.5px solid #1e1e2a',
          borderRadius: '12px',
          maxWidth: '480px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          color: '#e8e8f0',
          fontFamily: 'inherit',
          padding: '0'
        }}
      >
        {/* ── Track header ─────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            padding: '16px',
            borderBottom: '0.5px solid #1e1e2a'
          }}
        >
          {/* Artwork */}
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '6px',
              overflow: 'hidden',
              background: '#1e1e2a',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: '28px', color: '#333' }}>♪</span>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 500,
                marginBottom: '3px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {track.title ?? track.filename ?? 'Untitled'}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: '#555',
                marginBottom: '8px'
              }}
            >
              {track.artist ?? 'Unknown'}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {track.bpm && (
                <Badge
                  variant="outline"
                  style={{
                    fontSize: '10px',
                    background: '#1a2535',
                    color: '#5d9fd8',
                    borderColor: '#1a2535'
                  }}
                >
                  {track.bpm} BPM
                </Badge>
              )}
              {track.key_camelot && (
                <Badge
                  variant="outline"
                  style={{
                    fontSize: '10px',
                    background: '#1a2830',
                    color: '#3db88a',
                    borderColor: '#1a2830'
                  }}
                >
                  {track.key_camelot}
                </Badge>
              )}
              {track.duration_str && (
                <span style={{ fontSize: '11px', color: '#555' }}>{track.duration_str}</span>
              )}
            </div>
          </div>

          {/* Play button */}
          <button
            onClick={togglePlay}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: isPlaying ? '#1d9e75' : '#7f77dd',
              border: 'none',
              color: '#fff',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              alignSelf: 'center',
              transition: 'background 0.15s'
            }}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
        </div>

        {/* ── Workflow section ──────────────────────── */}
        <div style={{ padding: '14px 16px' }}>
          {/* Column picker */}
          <div style={{ marginBottom: '14px' }}>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 500,
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                color: '#444',
                marginBottom: '8px'
              }}
            >
              Board column
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {BOARD_COLUMNS.map((col) => {
                const isActive = track.board_id === col.id
                return (
                  <button
                    key={col.id}
                    onClick={() => moveToColumn(col.id)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '20px',
                      border: `0.5px solid ${col.color}`,
                      background: isActive ? col.color : col.color + '22',
                      color: isActive ? '#fff' : col.color,
                      fontSize: '11px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.1s'
                    }}
                  >
                    {col.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Quick tags */}
          {quickTags.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 500,
                  letterSpacing: '0.8px',
                  textTransform: 'uppercase',
                  color: '#444',
                  marginBottom: '8px'
                }}
              >
                Quick tags
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {quickTags.map((tag) => {
                  const isApplied = commentTagIds.has(tag.id)
                  return (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      onClick={() => toggleQuickTag(tag)}
                      style={{
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '3px 10px',
                        background: isApplied ? tag.color : tag.color + '22',
                        color: isApplied ? '#fff' : tag.color,
                        borderColor: tag.color + '88',
                        fontWeight: 500,
                        transition: 'all 0.1s',
                        userSelect: 'none'
                      }}
                    >
                      {tag.value}
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}

          {/* Quick editable fields — tab through fast */}
          <div style={{ marginBottom: '14px' }}>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 500,
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                color: '#444',
                marginBottom: '8px'
              }}
            >
              Quick edit — Tab to move between fields
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px'
              }}
            >
              {[
                { field: 'bpm', label: 'BPM' },
                { field: 'key_camelot', label: 'Key' }
              ].map(({ field, label }) => (
                <div key={field}>
                  <div
                    style={{
                      fontSize: '10px',
                      color: '#444',
                      marginBottom: '3px'
                    }}
                  >
                    {label}
                  </div>
                  <input
                    data-board-field={field}
                    defaultValue={(track[field as keyof Track] as string) ?? ''}
                    onKeyDown={(e) => handleKeyDown(e, field, e.currentTarget.value)}
                    style={{
                      width: '100%',
                      background: '#1a1a26',
                      border: '0.5px solid #252535',
                      borderRadius: '5px',
                      padding: '5px 8px',
                      color: '#c0c0d8',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      outline: 'none'
                    }}
                    onFocus={(e) => (e.target.style.borderColor = '#7f77dd')}
                    onBlur={(e) => {
                      e.target.style.borderColor = '#252535'
                      saveField(field, e.target.value)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <Separator className="bg-[#1e1e2a]" />

        {/* ── Collapsible full metadata ─────────────── */}
        <div>
          <button
            onClick={() => setMetaOpen((o) => !o)}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              color: '#555',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: 'inherit'
            }}
          >
            <span>Full metadata</span>
            <span
              style={{
                transform: metaOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
                fontSize: '10px'
              }}
            >
              ▾
            </span>
          </button>

          {metaOpen && (
            <div style={{ padding: '0 16px 16px' }}>
              {/* All tag fields */}
              {[
                { field: 'genre', label: 'Genre', color: '#9b8ed4' },
                { field: 'comment', label: 'Comment', color: '#7f77dd' },
                { field: 'grouping', label: 'Grouping', color: '#1d9e75' },
                { field: 'remixer', label: 'Remixer', color: '#d85a30' },
                { field: 'label', label: 'Label', color: '#378add' }
              ].map(({ field, label, color }) => (
                <TagInput
                  key={field}
                  trackId={track.id}
                  field={field}
                  label={label}
                  color={color}
                />
              ))}

              {/* Energy slider */}
              <div style={{ marginTop: '8px' }}>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 500,
                    letterSpacing: '0.8px',
                    textTransform: 'uppercase',
                    color: '#444',
                    marginBottom: '6px'
                  }}
                >
                  Energy
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Slider
                    defaultValue={[track.energy ?? 5]}
                    min={1}
                    max={10}
                    step={1}
                    onValueCommit={(val) => saveField('energy', val[0].toString())}
                    className="flex-1"
                  />
                  <span style={{ fontSize: '12px', color: '#555', minWidth: '16px' }}>
                    {track.energy ?? '—'}
                  </span>
                </div>
              </div>

              {/* Read-only info */}
              <div
                style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                {[
                  { label: 'Duration', value: track.duration_str },
                  { label: 'Format', value: track.format },
                  { label: 'Year', value: track.year }
                ].map(({ label, value }) =>
                  value ? (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          color: '#444',
                          textTransform: 'uppercase',
                          letterSpacing: '0.6px'
                        }}
                      >
                        {label}
                      </span>
                      <span style={{ fontSize: '12px', color: '#c0c0d8' }}>{value}</span>
                    </div>
                  ) : null
                )}
              </div>

              {/* Filepath */}
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '10px', color: '#333', marginBottom: '3px' }}>
                  FILE PATH
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    color: '#444',
                    wordBreak: 'break-all',
                    lineHeight: 1.5
                  }}
                >
                  {track.filepath}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
