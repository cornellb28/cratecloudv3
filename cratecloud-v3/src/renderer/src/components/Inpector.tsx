import React, { useRef, useEffect } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Input } from '@renderer/components/ui/input'
import { Slider } from '@renderer/components/ui/slider'
import { Separator } from '@renderer/components/ui/separator'

export function Inspector(): React.JSX.Element {
  const { tracks, activeTrackId, setActiveTrack, updateTrack } = useLibraryStore()

  const track = tracks.find(t => t.id === activeTrackId) ?? null
  const isOpen = track !== null

  // Focus the title field when a track is selected
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen && titleRef.current) {
      titleRef.current.focus()
      titleRef.current.select()
    }
  }, [activeTrackId])  // re-run when the active track changes

  // Save a single field to SQLite and the store
  async function saveField(field: string, value: string): Promise<void> {
    if (!track) return

    // Update the store immediately — optimistic update
    // The UI reflects the change before the IPC call finishes
    updateTrack(track.id, { [field]: value })

    // Save to SQLite via IPC
    await window.api.db.updateTrackMeta({
      id: track.id,
      title: track.title,
      artist: track.artist,
      genre: track.genre,
      bpm: track.bpm,
      key_camelot: track.key_camelot,
      energy: track.energy,
      comment: track.comment,
      needs_sync: track.needs_sync,
      pending_changes: track.pending_changes,
      // Override with the new value
      [field]: field === 'bpm' ? parseFloat(value) || null : value || null,
    })
  }

  // Handle Enter key — saves and moves focus to next field
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, field: string): void {
    if (e.key === 'Enter') {
      saveField(field, e.currentTarget.value)
      e.currentTarget.blur()
    }
    if (e.key === 'Escape') {
      e.currentTarget.blur()
    }
  }

  return (
    <div style={{
      width: isOpen ? '260px' : '0px',
      flexShrink: 0,
      background: '#12121a',
      borderLeft: isOpen ? '0.5px solid #1e1e2a' : 'none',
      overflowY: isOpen ? 'auto' : 'hidden',
      overflowX: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.25s ease',
    }}>

      {isOpen && track && (
        <div style={{
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minWidth: '260px',
        }}>

          {/* Close button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setActiveTrack(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#444',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Artwork */}
          <div style={{
            width: '100%',
            aspectRatio: '1',
            borderRadius: '8px',
            overflow: 'hidden',
            background: '#1e1e2a',
            marginBottom: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {track.artwork_path ? (
              <img
                src={`file://${track.artwork_path}`}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: '48px', color: '#333' }}>♪</span>
            )}
          </div>

          {/* Divider */}
          <Separator className="bg-[#1e1e2a]" />

          {/* Editable fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            <EditField
              ref={titleRef}
              label="Title"
              defaultValue={track.title ?? ''}
              onSave={(v) => saveField('title', v)}
              onKeyDown={(e) => onKeyDown(e, 'title')}
            />

            <EditField
              label="Artist"
              defaultValue={track.artist ?? ''}
              onSave={(v) => saveField('artist', v)}
              onKeyDown={(e) => onKeyDown(e, 'artist')}
            />

            <EditField
              label="Genre"
              defaultValue={track.genre ?? ''}
              onSave={(v) => saveField('genre', v)}
              onKeyDown={(e) => onKeyDown(e, 'genre')}
            />

            <EditField
              label="BPM"
              defaultValue={track.bpm?.toString() ?? ''}
              onSave={(v) => saveField('bpm', v)}
              onKeyDown={(e) => onKeyDown(e, 'bpm')}
            />

            <EditField
              label="Key"
              defaultValue={track.key_camelot ?? ''}
              onSave={(v) => saveField('key_camelot', v)}
              onKeyDown={(e) => onKeyDown(e, 'key_camelot')}
            />

            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
                Energy
              </label>
              <div className="flex items-center gap-3">
                <Slider
                  defaultValue={[track.energy ?? 5]}
                  min={1}
                  max={10}
                  step={1}
                  onValueCommit={(val) => saveField('energy', val[0].toString())}
                  className="flex-1"
                />
                <span className="text-xs font-mono text-muted-foreground w-4 text-right">
                  {track.energy ?? '—'}
                </span>
              </div>
            </div>

            <EditField
              label="Album"
              defaultValue={track.album ?? ''}
              onSave={(v) => saveField('album', v)}
              onKeyDown={(e) => onKeyDown(e, 'album')}
            />

            <EditField
              label="Year"
              defaultValue={track.year ?? ''}
              onSave={(v) => saveField('year', v)}
              onKeyDown={(e) => onKeyDown(e, 'year')}
            />

          </div>

          {/* Divider */}
          <Separator className="bg-[#1e1e2a]" />

          {/* Read-only fields */}
          <ReadField label="Duration" value={track.duration_str} />
          <ReadField label="Format" value={track.format} />
          <ReadField label="Key full" value={track.key_full} />

          {/* Divider */}
          <Separator className="bg-[#1e1e2a]" />

          {/* File path — read only */}
          <div>
            <div style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: '#333',
              marginBottom: '4px',
            }}>
              File path
            </div>
            <div style={{
              fontSize: '10px',
              color: '#444',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}>
              {track.filepath}
            </div>
          </div>

        </div>
      )}

    </div>
  )
}

// ─── Editable field ───────────────────────────────────────

interface EditFieldProps {
  label: string
  defaultValue: string
  onSave: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

const EditField = React.forwardRef<HTMLInputElement, EditFieldProps>(
  ({ label, defaultValue, onSave, onKeyDown }, ref) => {
    return (
      <div>
        <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
          {label}
        </label>
        <Input
          ref={ref}
          defaultValue={defaultValue}
          onBlur={(e) => onSave(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-7 text-xs font-mono bg-[#1a1a26] border-[#252535] text-[#c0c0d8] focus-visible:ring-[#7f77dd]"
        />
      </div>
    )
  }
)

EditField.displayName = 'EditField'

// ─── Read-only field ──────────────────────────────────────

function ReadField({ label, value }: { label: string; value?: string | null }): React.JSX.Element | null {

  if (!value) return null

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{
        fontSize: '11px',
        fontWeight: 500,
        letterSpacing: '0.6px',
        textTransform: 'uppercase',
        color: '#444',
      }}>
        {label}
      </span>
      <span style={{ fontSize: '12px', color: '#c0c0d8' }}>
        {value}
      </span>
    </div>
  )
}
