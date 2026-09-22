import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, Undo2 } from 'lucide-react'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { TagInput } from './TagInput'
import { useLibraryStore } from '../store/useLibraryStore'
import { useArtworkUrl } from '../hooks/useArtworkUrl'
import { fieldToMetaKey, withTrackIdentity } from '../lib/tagMeta'

// ─── Types ───────────────────────────────────────────────

interface BulkEditModalProps {
  trackIds: number[]
  open: boolean
  onClose: () => void
}

// Fields that use TagInput (badge system). These save themselves the moment
// a badge is added or removed — they are NOT part of this modal's dirty
// state, and the footer says so, otherwise "Save" would look like it covers
// them too.
const TAG_FIELDS = [
  { field: 'genre', label: 'Genre', color: '#9b8ed4' },
  { field: 'comment', label: 'Comment', color: '#7f77dd' },
  { field: 'grouping', label: 'Grouping', color: '#1d9e75' },
  { field: 'remixer', label: 'Remixer', color: '#d85a30' },
  { field: 'label', label: 'Label', color: '#378add' }
]

// Fields held as plain text until an explicit save.
const TEXT_FIELDS = [
  { field: 'bpm', label: 'BPM' },
  { field: 'key_camelot', label: 'Key' }
]

const YEARS = Array.from(
  { length: new Date().getFullYear() - 1950 + 1 },
  (_, i) => new Date().getFullYear() - i
)

const ACCENT = '#7f77dd'

type FileWrite = { filepath: string; meta: EditTagsMeta }

// What the user asked to happen once the save lands.
type SaveIntent = 'stay' | 'continue' | 'close'

// A navigation the user asked for that is waiting on unsaved changes.
type PendingNav = { kind: 'index'; index: number } | { kind: 'close' } | null

// ─── Main component ───────────────────────────────────────

export function BulkEditModal({
  trackIds,
  open,
  onClose
}: BulkEditModalProps): React.JSX.Element | null {
  const { tracks, updateTrack } = useLibraryStore()

  const [currentIndex, setCurrentIndex] = useState(0)
  const [checkedFields, setCheckedFields] = useState<Set<string>>(new Set())
  const [textValues, setTextValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  // Tracks whose text fields this session has written, for the progress bar.
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set())
  const [pendingNav, setPendingNav] = useState<PendingNav>(null)

  // Reset volatile state when the modal transitions to open, and clear typed
  // values whenever the displayed track changes — both adjusted during
  // render (https://react.dev/learn/you-might-not-need-an-effect) rather
  // than via an effect, which would setState after paint.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setCurrentIndex(0)
      setCheckedFields(new Set())
      setTextValues({})
      setSavedIds(new Set())
      setPendingNav(null)
      setSaving(false)
    }
  }

  const currentTrackId = trackIds[currentIndex]
  const currentTrack = tracks.find((t) => t.id === currentTrackId)
  const artworkUrl = useArtworkUrl(currentTrack?.artwork_hash, 'full')

  const [lastTrackId, setLastTrackId] = useState(currentTrackId)
  if (currentTrackId !== lastTrackId) {
    setLastTrackId(currentTrackId)
    setTextValues({})
  }

  const isFirst = currentIndex === 0
  const isLast = currentIndex === trackIds.length - 1

  // ── Dirty tracking ───────────────────────────────────────
  // Only counts a field whose typed value actually differs from what the
  // track already holds — retyping the same BPM should not put the modal
  // into an unsaved state, or every Next would stop to ask about nothing.
  const dirtyFields = useMemo(() => {
    if (!currentTrack) return []
    return Object.entries(textValues)
      .filter(([field, value]) => {
        const existing = currentTrack[field as keyof Track]
        return String(existing ?? '') !== String(value ?? '')
      })
      .map(([field]) => field)
  }, [textValues, currentTrack])

  const isDirty = dirtyFields.length > 0

  function toggleField(field: string): void {
    setCheckedFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  // ── Navigation, guarded ──────────────────────────────────
  // Every way out of the current track funnels through here, so unsaved
  // text edits can never be dropped silently the way they were when
  // changing track just reset textValues.
  function requestNav(next: PendingNav): void {
    if (!next) return
    if (isDirty) {
      setPendingNav(next)
      return
    }
    applyNav(next)
  }

  function applyNav(nav: NonNullable<PendingNav>): void {
    setPendingNav(null)
    if (nav.kind === 'close') onClose()
    else setCurrentIndex(nav.index)
  }

  const goPrev = (): void => {
    if (!isFirst) requestNav({ kind: 'index', index: currentIndex - 1 })
  }
  const goNext = (): void => {
    if (!isLast) requestNav({ kind: 'index', index: currentIndex + 1 })
  }
  const requestClose = (): void => requestNav({ kind: 'close' })

  function revert(): void {
    setTextValues({})
    setPendingNav(null)
  }

  // ── Saving ───────────────────────────────────────────────
  // A bulk edit has to reach the file, not just the database. Everything is
  // accumulated first and sent as one batch job: one sidecar process for the
  // whole selection instead of one per track, with progress surfacing
  // through the background jobs panel.
  function collectFileWrite(
    writes: Map<number, FileWrite>,
    track: Track,
    meta: EditTagsMeta
  ): void {
    const existing = writes.get(track.id)
    writes.set(track.id, {
      filepath: track.filepath,
      meta: withTrackIdentity(track, { ...(existing?.meta ?? {}), ...meta })
    })
  }

  // textValues holds raw input strings; bpm has to become a number before it
  // goes near a REAL column or edit_tags.py.
  function columnValue(field: string, raw: string): string | number | null {
    if (field === 'bpm') return parseFloat(raw) || null
    return raw || null
  }

  async function save(intent: SaveIntent): Promise<void> {
    if (!currentTrack || saving) return
    setSaving(true)

    const fileWrites = new Map<number, FileWrite>()
    const pendingDbWrites: (Partial<Track> & { id: number })[] = []
    const savedNow = new Set<number>()

    function applyToTrack(track: Track, fields: string[]): void {
      const columns: Record<string, unknown> = {}
      const meta: EditTagsMeta = {}
      for (const field of fields) {
        const value = columnValue(field, textValues[field])
        columns[field] = value
        meta[fieldToMetaKey(field)] = (value ?? '') as never
      }
      updateTrack(track.id, columns as Partial<Track>)
      collectFileWrite(fileWrites, track, meta)
      pendingDbWrites.push({ id: track.id, ...columns } as Partial<Track> & { id: number })
      savedNow.add(track.id)
    }

    try {
      // This track: every text field that was actually typed into.
      const editedFields = EDITABLE_TEXT_FIELDS.filter(
        (field) => textValues[field] !== undefined
      )
      if (editedFields.length > 0) applyToTrack(currentTrack, editedFields)

      // Every other selected track: only the fields whose checkbox is on.
      const bulkFields = editedFields.filter((field) => checkedFields.has(field))
      if (bulkFields.length > 0) {
        for (const trackId of trackIds) {
          if (trackId === currentTrack.id) continue
          const track = tracks.find((t) => t.id === trackId)
          if (track) applyToTrack(track, bulkFields)
        }
      }

      // Bulk apply checked tag fields: copy this track's badges for that
      // field onto every other selected track. TagInput already saved this
      // track's own badges — to its row and to its file — when they were
      // added, so this only has to replicate them onto the rest.
      const checkedTagFields = TAG_FIELDS.filter(({ field }) => checkedFields.has(field))
      if (checkedTagFields.length > 0) {
        const currentTags = await window.api.tags.forTrack(currentTrack.id)

        for (const { field } of checkedTagFields) {
          const tagsForField = currentTags.filter((t) => t.field === field)
          if (tagsForField.length === 0) continue

          // Same separator TagInput uses, so a field written here and one
          // written there read back identically.
          const joined = tagsForField.map((t) => t.value).join(' / ')

          for (const trackId of trackIds) {
            if (trackId === currentTrack.id) continue
            const track = tracks.find((t) => t.id === trackId)
            if (!track) continue

            for (const tag of tagsForField) {
              await window.api.tags.apply(trackId, tag.id)
            }

            const existingTags = await window.api.tags.forTrack(trackId)
            useLibraryStore.getState().setTrackTags(trackId, existingTags)

            updateTrack(trackId, { [field]: joined } as Partial<Track>)
            pendingDbWrites.push({ id: trackId, [field]: joined })
            collectFileWrite(fileWrites, track, { [fieldToMetaKey(field)]: joined })
            savedNow.add(trackId)
          }
        }
      }

      for (const write of pendingDbWrites) {
        const result = await window.api.db.updateTrackMeta(write)
        if (!result.ok) {
          toast.error('Could not save changes', { description: result.error ?? 'Unknown error' })
          return
        }
      }

      if (fileWrites.size > 0) {
        try {
          await window.api.editTagsBatch(Array.from(fileWrites.values()))
        } catch (err) {
          console.error('[BulkEditModal] editTagsBatch failed:', err)
          toast.error('Could not save to files', { description: (err as Error).message })
          return
        }
      }

      // Nothing to write is still a successful save — it just means the user
      // only touched tag badges, which saved themselves on the way in.
      if (savedNow.size > 0) {
        setSavedIds((prev) => new Set([...prev, ...savedNow]))
        toast.success(
          savedNow.size === 1
            ? 'Saved'
            : `Saved ${savedNow.size} tracks`
        )
      }
      setTextValues({})
      setPendingNav(null)

      if (intent === 'close') onClose()
      else if (intent === 'continue' && !isLast) setCurrentIndex(currentIndex + 1)
    } finally {
      setSaving(false)
    }
  }

  // ── Keyboard ─────────────────────────────────────────────
  // Arrow keys are ignored while focus is in a text field so they can move
  // the caret. The save shortcuts are not: they are modified keys, so they
  // cannot collide with typing, and being able to save without leaving the
  // field is the whole point of them.
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (!open) return
      const modified = e.metaKey || e.ctrlKey

      if (modified && e.key === 'Enter') {
        e.preventDefault()
        void save(isLast ? 'close' : 'continue')
        return
      }
      if (modified && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save('close')
        return
      }

      const target = e.target as HTMLElement | null
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (e.key === 'Escape') {
        e.preventDefault()
        if (pendingNav) setPendingNav(null)
        else requestClose()
        return
      }
      if (typing) return
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  if (!currentTrack) return null

  const bulkCount = trackIds.length
  const isBulk = bulkCount > 1
  const savedCount = trackIds.filter((id) => savedIds.has(id)).length

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Radix focuses the first focusable child on open, which is the
        // Genre tag input — and TagInput opens its dropdown on focus, so the
        // modal appeared with a suggestion list covering its own fields.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()} // handled above, so it can guard unsaved edits
        onInteractOutside={(e) => {
          if (isDirty) e.preventDefault()
        }}
        style={{
          background: '#13131b',
          border: '0.5px solid #1e1e2a',
          borderRadius: '12px',
          maxWidth: '620px',
          width: '100%',
          maxHeight: '85vh',
          color: '#e8e8f0',
          fontFamily: 'inherit',
          padding: 0,
          gap: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* ── Header ────────────────────────────────── */}
        <div style={{ flexShrink: 0, borderBottom: '0.5px solid #1e1e2a' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px'
            }}
          >
            <NavButton onClick={goPrev} disabled={isFirst} label="Previous track">
              <ChevronLeft size={16} />
            </NavButton>

            <div style={{ textAlign: 'center', minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: '#8a8aa0' }}>
                {isBulk ? `Track ${currentIndex + 1} of ${bulkCount}` : 'Edit labels'}
              </div>
              {isBulk && (
                <div style={{ fontSize: '10px', color: '#4a4a5c', marginTop: '2px' }}>
                  {savedCount === 0
                    ? 'None saved yet'
                    : `${savedCount} of ${bulkCount} saved`}
                </div>
              )}
            </div>

            <NavButton onClick={goNext} disabled={isLast} label="Next track">
              <ChevronRight size={16} />
            </NavButton>
          </div>

          {/* Progress through the selection — how much of this pass is done */}
          {isBulk && (
            <div style={{ height: '2px', background: '#1a1a26' }}>
              <div
                style={{
                  height: '100%',
                  width: `${(savedCount / bulkCount) * 100}%`,
                  background: ACCENT,
                  transition: 'width 0.2s ease'
                }}
              />
            </div>
          )}
        </div>

        {/* ── Track header ──────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            padding: '12px 16px',
            borderBottom: '0.5px solid #1e1e2a',
            flexShrink: 0
          }}
        >
          <div
            style={{
              width: '84px',
              height: '84px',
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
              <span style={{ fontSize: '24px', color: '#333' }}>♪</span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                marginBottom: '3px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {currentTrack.title ?? currentTrack.filename ?? 'Untitled'}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: '#555',
                marginBottom: '8px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {currentTrack.artist ?? 'Unknown artist'}
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {currentTrack.bpm && (
                <Badge
                  variant="outline"
                  style={{
                    fontSize: '10px',
                    background: '#1a2535',
                    color: '#5d9fd8',
                    borderColor: '#1a2535'
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
                    borderColor: '#1a2830'
                  }}
                >
                  {currentTrack.key_camelot}
                </Badge>
              )}
              {savedIds.has(currentTrack.id) && (
                <Badge
                  variant="outline"
                  style={{
                    fontSize: '10px',
                    background: '#1b2a22',
                    color: '#3db88a',
                    borderColor: '#1b2a22',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}
                >
                  <Check size={9} /> Saved
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* ── Fields ───────────────────────────────── */}
        <div style={{ padding: '14px 16px 18px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {/* Both rules live here, above the scroll fold, rather than as a
              footnote at the bottom of a list long enough to hide it. */}
          <div
            style={{
              fontSize: '11px',
              color: '#6a6a80',
              marginBottom: '14px',
              padding: '8px 10px',
              background: '#1a1a26',
              borderRadius: '6px',
              borderLeft: `2px solid ${ACCENT}`,
              lineHeight: 1.6
            }}
          >
            {isBulk && (
              <div style={{ marginBottom: '4px' }}>
                Tick a field to apply it to all {bulkCount} selected tracks. Unticked fields
                only change this one.
              </div>
            )}
            <div style={{ color: '#55556a' }}>
              Tag badges save as you add them. BPM, key and year save when you press one of
              the save buttons.
            </div>
          </div>

          {TAG_FIELDS.map(({ field, label, color }) => (
            <FieldRow
              key={field}
              showCheckbox={isBulk}
              checked={checkedFields.has(field)}
              onToggle={() => toggleField(field)}
              color={color}
              align="flex-start"
              checkboxOffset="20px"
            >
              <TagInput trackId={currentTrack.id} field={field} label={label} color={color} />
            </FieldRow>
          ))}

          {TEXT_FIELDS.map(({ field, label }) => (
            <FieldRow
              key={field}
              showCheckbox={isBulk}
              checked={checkedFields.has(field)}
              onToggle={() => toggleField(field)}
              color={ACCENT}
            >
              <InlineLabel text={label} dirty={dirtyFields.includes(field)} />
              <input
                key={`${currentTrack.id}-${field}`}
                defaultValue={(currentTrack[field as keyof Track] as string) ?? ''}
                onChange={(e) =>
                  setTextValues((prev) => ({ ...prev, [field]: e.target.value }))
                }
                style={fieldControlStyle(dirtyFields.includes(field))}
                onFocus={(e) => (e.target.style.borderColor = ACCENT)}
                onBlur={(e) =>
                  (e.target.style.borderColor = dirtyFields.includes(field)
                    ? ACCENT
                    : '#252535')
                }
              />
            </FieldRow>
          ))}

          {/* Year — a select rather than free text, but the same row shape */}
          <FieldRow
            showCheckbox={isBulk}
            checked={checkedFields.has('year')}
            onToggle={() => toggleField('year')}
            color={ACCENT}
          >
            <InlineLabel text="Year" dirty={dirtyFields.includes('year')} />
            <select
              key={`${currentTrack.id}-year`}
              // No fallback to the current year: defaulting an untagged
              // track to "now" and saving would stamp a wrong release year
              // across the whole selection.
              defaultValue={currentTrack.year ?? ''}
              onChange={(e) => setTextValues((prev) => ({ ...prev, year: e.target.value }))}
              style={{ ...fieldControlStyle(dirtyFields.includes('year')), cursor: 'pointer' }}
              onFocus={(e) => (e.target.style.borderColor = ACCENT)}
              onBlur={(e) =>
                (e.target.style.borderColor = dirtyFields.includes('year') ? ACCENT : '#252535')
              }
            >
              <option value="">—</option>
              {YEARS.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>

        {/* ── Unsaved guard ────────────────────────── */}
        {pendingNav && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              padding: '10px 16px',
              background: '#2a2118',
              borderTop: '0.5px solid #4a3a20',
              flexShrink: 0
            }}
          >
            <span style={{ fontSize: '11px', color: '#d8b87a' }}>
              {dirtyFields.length} unsaved{' '}
              {dirtyFields.length === 1 ? 'change' : 'changes'} on this track.
            </span>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setPendingNav(null)}
                style={{ color: '#8a8aa0' }}
              >
                Keep editing
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  const nav = pendingNav
                  revert()
                  applyNav(nav)
                }}
                style={{ borderColor: '#4a3a20', color: '#d8b87a' }}
              >
                Discard
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={saving}
                onClick={() => void save(pendingNav.kind === 'close' ? 'close' : 'continue')}
                style={{ borderColor: ACCENT, color: '#a09be8' }}
              >
                Save
              </Button>
            </div>
          </div>
        )}

        {/* ── Footer ───────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderTop: '0.5px solid #1e1e2a',
            flexShrink: 0,
            gap: '10px'
          }}
        >
          <div style={{ fontSize: '11px', color: '#5a5a70', minWidth: 0 }}>
            {checkedFields.size > 0 ? (
              <span style={{ color: '#a09be8' }}>
                Applying {checkedFields.size} field{checkedFields.size > 1 ? 's' : ''} to all{' '}
                {bulkCount}
              </span>
            ) : isDirty ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: ACCENT
                  }}
                />
                Unsaved
              </span>
            ) : (
              'No unsaved changes'
            )}
          </div>

          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            {isDirty && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={revert}
                disabled={saving}
                style={{ color: '#6a6a80' }}
                title="Discard this track's unsaved changes"
              >
                <Undo2 size={12} style={{ marginRight: '4px' }} />
                Revert
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={saving}
              onClick={() => void save('close')}
              title="Save and close (⌘S)"
            >
              {saving ? 'Saving…' : 'Save and close'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={saving || isLast}
              onClick={() => void save('continue')}
              style={{
                borderColor: isLast ? '#252535' : ACCENT,
                color: isLast ? '#3f3f4e' : '#a09be8'
              }}
              title={
                isLast
                  ? 'This is the last track in the selection'
                  : 'Save and go to the next track (⌘↵)'
              }
            >
              Save and continue
              <ChevronRight size={12} style={{ marginLeft: '2px' }} />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Every field the modal writes on an explicit save.
const EDITABLE_TEXT_FIELDS = [...TEXT_FIELDS.map((f) => f.field), 'year']

// ─── Small pieces ─────────────────────────────────────────

function fieldControlStyle(dirty: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    background: '#1a1a26',
    border: `0.5px solid ${dirty ? ACCENT : '#252535'}`,
    borderRadius: '5px',
    padding: '5px 8px',
    color: '#c0c0d8',
    fontSize: '12px',
    fontFamily: 'monospace',
    outline: 'none'
  }
}

function InlineLabel({ text, dirty }: { text: string; dirty: boolean }): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 500,
        letterSpacing: '0.8px',
        textTransform: 'uppercase',
        color: dirty ? '#a09be8' : '#444',
        minWidth: '52px',
        flexShrink: 0
      }}
    >
      {text}
    </div>
  )
}

function NavButton({
  onClick,
  disabled,
  label,
  children
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        background: 'none',
        border: 'none',
        color: disabled ? '#2e2e3a' : ACCENT,
        cursor: disabled ? 'default' : 'pointer',
        padding: '4px 8px',
        display: 'flex',
        alignItems: 'center'
      }}
    >
      {children}
    </button>
  )
}

// One row shape for every field, so the bulk-apply checkbox, the label and
// the control line up whether the control is a tag input, a text box or a
// select.
function FieldRow({
  showCheckbox,
  checked,
  onToggle,
  color,
  align = 'center',
  checkboxOffset,
  children
}: {
  showCheckbox: boolean
  checked: boolean
  onToggle: () => void
  color: string
  align?: 'center' | 'flex-start'
  checkboxOffset?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: align,
        gap: '10px',
        marginBottom: '12px'
      }}
    >
      {showCheckbox && (
        <button
          onClick={onToggle}
          role="checkbox"
          aria-checked={checked}
          aria-label="Apply this field to every selected track"
          title="Apply this field to every selected track"
          style={{
            width: '16px',
            height: '16px',
            padding: 0,
            borderRadius: '3px',
            border: `0.5px solid ${checked ? color : '#333'}`,
            background: checked ? color : 'none',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            marginTop: checkboxOffset,
            transition: 'all 0.1s'
          }}
        >
          {checked && <Check size={10} color="#fff" />}
        </button>
      )}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: align === 'center' ? 'center' : 'stretch',
          gap: '10px',
          flexDirection: align === 'center' ? 'row' : 'column'
        }}
      >
        {children}
      </div>
    </div>
  )
}
