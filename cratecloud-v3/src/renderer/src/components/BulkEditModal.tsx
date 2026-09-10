import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { TagInput } from './TagInput'
import { useLibraryStore } from '../store/useLibraryStore'
import { useArtworkUrl } from '../hooks/useArtworkUrl'

// ─── Types ───────────────────────────────────────────────

interface BulkEditModalProps {
  trackIds: number[]
  open: boolean
  onClose: () => void
}

// Fields that use TagInput (badge system)
const TAG_FIELDS = [
  { field: 'genre', label: 'Genre', color: '#9b8ed4' },
  { field: 'comment', label: 'Comment', color: '#7f77dd' },
  { field: 'grouping', label: 'Grouping', color: '#1d9e75' },
  { field: 'remixer', label: 'Remixer', color: '#d85a30' },
  { field: 'label', label: 'Label', color: '#378add' },
]

// Fields that use plain text input
const TEXT_FIELDS = [
  { field: 'bpm', label: 'BPM' },
  { field: 'key_camelot', label: 'Key' },
]

// ─── Main component ───────────────────────────────────────

export function BulkEditModal({ trackIds, open, onClose }: BulkEditModalProps): React.JSX.Element | null {
  const { tracks, updateTrack } = useLibraryStore()

  // Current track index within the selected set
  const [currentIndex, setCurrentIndex] = useState(0)

  // Which fields are checked for bulk apply
  const [checkedFields, setCheckedFields] = useState<Set<string>>(new Set())

  // Text field values for plain inputs
  const [textValues, setTextValues] = useState<Record<string, string>>({})

  // Saving state
  const [saving, setSaving] = useState(false)

  // Reset all volatile state when the modal transitions to open, and clear
  // typed text values whenever the displayed track changes — both adjusted
  // during render (React's pattern for resetting state in response to a
  // prop change: https://react.dev/learn/you-might-not-need-an-effect)
  // rather than via an effect, which would call setState after paint and
  // trigger an extra, avoidable render pass.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setCurrentIndex(0)
      setCheckedFields(new Set())
      setTextValues({})
    }
  }

  // Current track being edited
  const currentTrackId = trackIds[currentIndex]
  const currentTrack = tracks.find(t => t.id === currentTrackId)
  const artworkUrl = useArtworkUrl(currentTrack?.artwork_hash, 'full')

  const [lastTrackId, setLastTrackId] = useState(currentTrackId)
  if (currentTrackId !== lastTrackId) {
    setLastTrackId(currentTrackId)
    setTextValues({})
  }

  // Toggle a field checkbox
  function toggleField(field: string): void {
    setCheckedFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  // Navigate to previous track
  function goPrev(): void {
    if (currentIndex > 0) setCurrentIndex(i => i - 1)
  }

  // Navigate to next track
  function goNext(): void {
    if (currentIndex < trackIds.length - 1) setCurrentIndex(i => i + 1)
  }

  // Keyboard navigation inside modal.
  // Ignored while focus is inside a text input or the tag search box so
  // arrow/escape keys can be used for cursor movement and dismissing tag
  // dropdowns without also navigating tracks or closing the whole modal.
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (!open) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, currentIndex, trackIds.length])

  // Save text fields for current track + bulk apply checked fields
  async function handleSave(): Promise<void> {
    if (!currentTrack) return
    setSaving(true)

    // Build the changes for this track
    const changes: Partial<Track> = {}
    for (const { field } of TEXT_FIELDS) {
      if (textValues[field] !== undefined) {
        changes[field as keyof Track] = textValues[field] as any
      }
    }

    // Update this track
    if (Object.keys(changes).length > 0) {
      updateTrack(currentTrack.id, changes)
      await window.api.db.updateTrackMeta({
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        genre: currentTrack.genre,
        bpm: currentTrack.bpm,
        key_camelot: currentTrack.key_camelot,
        energy: currentTrack.energy,
        comment: currentTrack.comment,
        artwork_path: currentTrack.artwork_path,
        needs_sync: currentTrack.needs_sync,
        pending_changes: currentTrack.pending_changes,
        ...changes,
      })
    }

    // Bulk apply checked text fields to all other selected tracks
    if (checkedFields.size > 0) {
      const bulkChanges: Partial<Track> = {}
      for (const { field } of TEXT_FIELDS) {
        if (checkedFields.has(field) && textValues[field] !== undefined) {
          bulkChanges[field as keyof Track] = textValues[field] as any
        }
      }

      if (Object.keys(bulkChanges).length > 0) {
        for (const trackId of trackIds) {
          if (trackId === currentTrack.id) continue
          const t = tracks.find(t => t.id === trackId)
          if (!t) continue

          updateTrack(trackId, bulkChanges)
          await window.api.db.updateTrackMeta({
            id: trackId,
            title: t.title,
            artist: t.artist,
            genre: t.genre,
            bpm: t.bpm,
            key_camelot: t.key_camelot,
            energy: t.energy,
            comment: t.comment,
            artwork_path: t.artwork_path,
            needs_sync: t.needs_sync,
            pending_changes: t.pending_changes,
            ...bulkChanges,
          })
        }
      }
    }

    // Bulk apply checked tag fields (genre/comment/grouping/remixer/label):
    // copy the current track's tags for that field onto every other
    // selected track. TagInput saves tags per-track immediately on its
    // own, so this only needs to replicate them, not save the current one.
    const checkedTagFields = TAG_FIELDS.filter(({ field }) => checkedFields.has(field))
    if (checkedTagFields.length > 0) {
      const currentTags = await window.api.tags.forTrack(currentTrack.id)

      for (const { field } of checkedTagFields) {
        const tagsForField = currentTags.filter(t => t.field === field)
        if (tagsForField.length === 0) continue

        for (const trackId of trackIds) {
          if (trackId === currentTrack.id) continue

          for (const tag of tagsForField) {
            await window.api.tags.apply(trackId, tag.id)
          }

          const existingTags = await window.api.tags.forTrack(trackId)
          useLibraryStore.getState().setTrackTags(trackId, existingTags)
        }
      }
    }

    setSaving(false)
  }

  if (!currentTrack) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        style={{
          background: '#13131b',
          border: '0.5px solid #1e1e2a',
          borderRadius: '12px',
          maxWidth: '620px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          color: '#e8e8f0',
          fontFamily: 'inherit',
          padding: '0',
        }}
      >

        {/* ── Header ────────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '0.5px solid #1e1e2a',
          flexShrink: 0,
        }}>
          {/* Prev */}
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            style={{
              background: 'none',
              border: 'none',
              color: currentIndex === 0 ? '#333' : '#7f77dd',
              cursor: currentIndex === 0 ? 'default' : 'pointer',
              fontSize: '18px',
              padding: '0 8px',
            }}
          >
            ←
          </button>

          {/* Track position */}
          <span style={{ fontSize: '12px', color: '#555' }}>
            {currentIndex + 1} of {trackIds.length}
          </span>

          {/* Next */}
          <button
            onClick={goNext}
            disabled={currentIndex === trackIds.length - 1}
            style={{
              background: 'none',
              border: 'none',
              color: currentIndex === trackIds.length - 1
                ? '#333'
                : '#7f77dd',
              cursor: currentIndex === trackIds.length - 1
                ? 'default'
                : 'pointer',
              fontSize: '18px',
              padding: '0 8px',
            }}
          >
            →
          </button>
        </div>

        {/* ── Track header ──────────────────────────── */}
        <div style={{
          display: 'flex',
          gap: '12px',
          padding: '14px 16px',
          borderBottom: '0.5px solid #1e1e2a',
          flexShrink: 0,
        }}>
          {/* Artwork */}
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '6px',
            overflow: 'hidden',
            background: '#1e1e2a',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: '24px', color: '#333' }}>♪</span>
            )}
          </div>

          {/* Year selector */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '10px',
            }}
          >
            {/* Checkbox for bulk apply */}
            {trackIds.length > 1 && (
              <div
                onClick={() => toggleField('year')}
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '3px',
                  border: checkedFields.has('year')
                    ? '0.5px solid #7f77dd'
                    : '0.5px solid #333',
                  background: checkedFields.has('year') ? '#7f77dd' : 'none',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {checkedFields.has('year') && (
                  <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>
                )}
              </div>
            )}

            {/* Label */}
            <div style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: '#444',
              minWidth: '52px',
              flexShrink: 0,
            }}>
              Year
            </div>

            {/* Year dropdown */}
            <select
              key={`${currentTrack.id}-year`}
              defaultValue={
                (currentTrack.year ?? String(new Date().getFullYear()))
              }
              onChange={e => setTextValues(prev => ({
                ...prev,
                year: e.target.value,
              }))}
              style={{
                flex: 1,
                background: '#1a1a26',
                border: '0.5px solid #252535',
                borderRadius: '5px',
                padding: '5px 8px',
                color: '#c0c0d8',
                fontSize: '12px',
                fontFamily: 'monospace',
                outline: 'none',
                cursor: 'pointer',
              }}
              onFocus={e => e.target.style.borderColor = '#7f77dd'}
              onBlur={e => e.target.style.borderColor = '#252535'}
            >
              {/* Generate years newest first */}
              {Array.from(
                { length: new Date().getFullYear() - 1950 + 1 },
                (_, i) => new Date().getFullYear() - i
              ).map(year => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 500,
              marginBottom: '3px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {currentTrack.title ?? currentTrack.filename ?? 'Untitled'}
            </div>
            <div style={{
              fontSize: '12px',
              color: '#555',
              marginBottom: '6px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {currentTrack.artist ?? 'Unknown artist'}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {currentTrack.bpm && (
                <Badge
                  variant="outline"
                  style={{
                    fontSize: '10px',
                    background: '#1a2535',
                    color: '#5d9fd8',
                    borderColor: '#1a2535',
                  }}
                >
                  {currentTrack.bpm} BPM
                </Badge>
              )}
              {currentTrack.key_camelot && (
                <Badge
                  variant="outline"
                  style={{
                    fontSize: '10px',
                    background: '#1a2830',
                    color: '#3db88a',
                    borderColor: '#1a2830',
                  }}
                >
                  {currentTrack.key_camelot}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* ── Fields ───────────────────────────────── */}
        <div style={{ padding: '14px 16px' }}>

          {/* Bulk apply hint */}
          {trackIds.length > 1 && (
            <div style={{
              fontSize: '11px',
              color: '#555',
              marginBottom: '12px',
              padding: '6px 10px',
              background: '#1a1a26',
              borderRadius: '6px',
              borderLeft: '2px solid #7f77dd',
            }}>
              ☐ Check a field to apply it to all {trackIds.length} selected tracks
            </div>
          )}

          {/* Tag fields with TagInput */}
          {TAG_FIELDS.map(({ field, label, color }) => (
            <div
              key={field}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                marginBottom: '12px',
              }}
            >
              {/* Checkbox */}
              {trackIds.length > 1 && (
                <div
                  onClick={() => toggleField(field)}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '3px',
                    border: checkedFields.has(field)
                      ? `0.5px solid ${color}`
                      : '0.5px solid #333',
                    background: checkedFields.has(field)
                      ? color
                      : 'none',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    marginTop: '20px',
                    transition: 'all 0.1s',
                  }}
                >
                  {checkedFields.has(field) && (
                    <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>
                  )}
                </div>
              )}

              {/* TagInput */}
              <div style={{ flex: 1 }}>
                <TagInput
                  trackId={currentTrack.id}
                  field={field}
                  label={label}
                  color={color}
                />
              </div>
            </div>
          ))}

          {/* Plain text fields */}
          {TEXT_FIELDS.map(({ field, label }) => (
            <div
              key={field}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              {/* Checkbox */}
              {trackIds.length > 1 && (
                <div
                  onClick={() => toggleField(field)}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '3px',
                    border: checkedFields.has(field)
                      ? '0.5px solid #7f77dd'
                      : '0.5px solid #333',
                    background: checkedFields.has(field)
                      ? '#7f77dd'
                      : 'none',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                  }}
                >
                  {checkedFields.has(field) && (
                    <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>
                  )}
                </div>
              )}

              {/* Label */}
              <div style={{
                fontSize: '10px',
                fontWeight: 500,
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                color: '#444',
                minWidth: '52px',
                flexShrink: 0,
              }}>
                {label}
              </div>

              {/* Input */}
              <input
                defaultValue={
                  (currentTrack[field as keyof Track] as string) ?? ''
                }
                key={`${currentTrack.id}-${field}`}
                onChange={e => setTextValues(prev => ({
                  ...prev,
                  [field]: e.target.value,
                }))}
                style={{
                  flex: 1,
                  background: '#1a1a26',
                  border: '0.5px solid #252535',
                  borderRadius: '5px',
                  padding: '5px 8px',
                  color: '#c0c0d8',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = '#7f77dd'}
                onBlur={e => e.target.style.borderColor = '#252535'}
              />
            </div>
          ))}
        </div>

        {/* ── Footer ───────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderTop: '0.5px solid #1e1e2a',
          flexShrink: 0,
          gap: '8px',
        }}>
          {/* Prev button */}
          <Button
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="text-xs"
          >
            ← Prev
          </Button>

          {/* Save */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="text-xs flex-1"
            style={{
              borderColor: '#7f77dd',
              color: '#a09be8',
            }}
          >
            {saving ? 'Saving...' : checkedFields.size > 0
              ? `Save + Apply ${checkedFields.size} field${checkedFields.size > 1 ? 's' : ''} to all ${trackIds.length}`
              : 'Save'
            }
          </Button>

          {/* Next button */}
          <Button
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={currentIndex === trackIds.length - 1}
            className="text-xs"
          >
            Next →
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  )
}
