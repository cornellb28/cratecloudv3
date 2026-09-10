import React, { useRef, useEffect, useState } from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Slider } from '@renderer/components/ui/slider'
import { Separator } from '@renderer/components/ui/separator'
import { TagInput } from './TagInput'
import { MoveFileButton } from './MoveFileButton'
import { Input } from '@renderer/components/ui/input'
import { getYearOptions } from '../utils/years'
import { useArtworkUrl } from '../hooks/useArtworkUrl'

const CAMELOT_KEYS = [
  '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
  '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B',
]

export function Inspector(): React.JSX.Element {
  const { tracks, activeTrackId, setActiveTrack, updateTrack, setTrackTags } = useLibraryStore()

  const track = tracks.find((t) => t.id === activeTrackId) ?? null
  const isOpen = track !== null
  const titleRef = useRef<HTMLInputElement>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const artworkUrl = useArtworkUrl(track?.artwork_hash, 'full')

  // Preload all tags for this track into store on open
  useEffect(() => {
    if (!activeTrackId) return
    async function preload(): Promise<void> {
      const result = await window.api.tags.forTrack(activeTrackId!)
      setTrackTags(activeTrackId!, result)
    }
    preload()
  }, [activeTrackId])

  // Auto-analyze if BPM or key is missing
  useEffect(() => {
    if (!track) return
    if (!track.bpm || !track.key_camelot) {
      autoAnalyze()
    }
  }, [activeTrackId])

  useEffect(() => {
    if (isOpen && titleRef.current) {
      titleRef.current.focus()
      titleRef.current.select()
    }
  }, [activeTrackId, isOpen])

  async function autoAnalyze(): Promise<void> {
    if (!track || analyzing) return
    setAnalyzing(true)
    try {
      const result = await window.api.analyzeFile(track.filepath)
      if (result.ok && result.data) {
        const { bpm, key_camelot, key_full, duration_sec, duration_str } = result.data
        updateTrack(track.id, { bpm, key_camelot, key_full, duration_sec, duration_str })
        await window.api.db.updateTrackMeta({
          id: track.id,
          title: track.title,
          artist: track.artist,
          genre: track.genre,
          bpm,
          key_camelot,
          energy: track.energy,
          comment: track.comment,
          needs_sync: track.needs_sync,
          pending_changes: track.pending_changes,
        })
        await window.api.db.markAnalyzed(track.id)
      }
    } catch (err) {
      console.error('Auto-analyze failed:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  async function saveField(field: string, value: string): Promise<void> {
    if (!track) return
    updateTrack(track.id, { [field]: value })
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
      [field]: field === 'bpm' ? parseFloat(value) || null : value || null
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, field: string): void {
    if (e.key === 'Enter') { saveField(field, e.currentTarget.value); e.currentTarget.blur() }
    if (e.key === 'Escape') { e.currentTarget.blur() }
  }

  return (
    <div
      data-testid="inspector-panel"
      style={{
        width: isOpen ? '260px' : '0px',
        flexShrink: 0,
        background: '#12121a',
        borderLeft: isOpen ? '0.5px solid #1e1e2a' : 'none',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.25s ease'
      }}
    >
      {isOpen && track && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: '260px',
          height: '100%',
          overflow: 'hidden'
        }}>

          {/* Fixed header */}
          <div style={{
            padding: '16px 16px 0 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setActiveTrack(null)}
                style={{
                  background: 'none', border: 'none',
                  color: '#444', cursor: 'pointer',
                  fontSize: '16px', padding: '0', lineHeight: 1
                }}
              >✕</button>
            </div>

            {/* Artwork */}
            <div style={{
              width: '100%', aspectRatio: '1',
              borderRadius: '8px', overflow: 'hidden',
              background: '#1e1e2a', marginBottom: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}>
              {artworkUrl ? (
                <img
                  src={artworkUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span style={{ fontSize: '48px', color: '#333' }}>♪</span>
              )}
              {/* Analyzing overlay */}
              {analyzing && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}>
                  <div style={{
                    fontSize: '24px',
                    color: '#7f77dd',
                    animation: 'spin 1s linear infinite',
                  }}>⟳</div>
                  <span style={{ fontSize: '11px', color: '#a09be8' }}>
                    Detecting BPM + key...
                  </span>
                </div>
              )}
            </div>

            <Separator className="bg-[#1e1e2a]" />
          </div>

          <MoveFileButton track={track} />

          {/* Scrollable editing section */}
          <div style={{
            flex: 1, minHeight: 0,
            overflowY: 'auto', overflowX: 'hidden',
            padding: '12px 16px'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

              <EditField
                ref={titleRef}
                data-testid="inspector-field-title"
                label="Title"
                defaultValue={track.title ?? ''}
                onSave={(v) => saveField('title', v)}
                onKeyDown={(e) => onKeyDown(e, 'title')}
              />

              <TagInput trackId={track.id} field="artist" label="Artist" color="#d4537e" />
              <TagInput trackId={track.id} field="genre" label="Genre" color="#9b8ed4" />
              <TagInput trackId={track.id} field="comment" label="Comment" color="#7f77dd" />
              <TagInput trackId={track.id} field="grouping" label="Grouping" color="#1d9e75" />
              <TagInput trackId={track.id} field="remixer" label="Remixer" color="#d85a30" />
              <TagInput trackId={track.id} field="label" label="Label" color="#378add" />
              <TagInput trackId={track.id} field="composer" label="Composer" color="#ba7517" />
              <TagInput trackId={track.id} field="album" label="Album" color="#888780" />

              {/* BPM — auto-detects if empty */}
              <div>
                <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
                  BPM
                </label>
                <div style={{ position: 'relative' }}>
                  <Input
                    key={`bpm-${track.id}-${track.bpm}`}
                    data-testid="inspector-field-bpm"
                    defaultValue={track.bpm?.toString() ?? ''}
                    disabled={analyzing}
                    placeholder={analyzing ? 'Detecting...' : ''}
                    onBlur={(e) => saveField('bpm', e.target.value)}
                    onKeyDown={(e) => onKeyDown(e, 'bpm')}
                    onFocus={(e) => e.target.select()}
                    className="h-7 text-xs font-mono bg-[#1a1a26] border-[#252535] text-[#c0c0d8] focus-visible:ring-[#7f77dd] pr-8"
                  />
                  {analyzing && (
                    <span style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '12px',
                      color: '#7f77dd',
                    }}>
                      ⟳
                    </span>
                  )}
                </div>
              </div>

              {/* Key — Camelot dropdown */}
              <div>
                <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
                  Key
                </label>
                <select
                  key={`key-${track.id}-${track.key_camelot}`}
                  data-testid="inspector-field-key"
                  defaultValue={track.key_camelot ?? ''}
                  disabled={analyzing}
                  onChange={(e) => saveField('key_camelot', e.target.value)}
                  style={{
                    width: '100%',
                    background: '#1a1a26',
                    border: '0.5px solid #252535',
                    borderRadius: '5px',
                    padding: '5px 8px',
                    color: track.key_camelot ? '#c0c0d8' : '#555',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none',
                    cursor: analyzing ? 'wait' : 'pointer',
                    height: '28px',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#7f77dd')}
                  onBlur={(e) => (e.target.style.borderColor = '#252535')}
                >
                  <option value="">
                    {analyzing ? 'Detecting...' : '— pick key —'}
                  </option>
                  {CAMELOT_KEYS.map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>

              {/* Energy slider */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
                  Energy
                </label>
                <div className="flex items-center gap-3">
                  <Slider
                    defaultValue={[track.energy ?? 5]}
                    min={1} max={10} step={1}
                    onValueCommit={(val) => saveField('energy', val[0].toString())}
                    className="flex-1"
                  />
                  <span className="text-xs font-mono text-muted-foreground w-4 text-right">
                    {track.energy ?? '—'}
                  </span>
                </div>
              </div>

              {/* Year */}
              <div>
                <div style={{
                  fontSize: '10px', fontWeight: 500,
                  letterSpacing: '0.8px', textTransform: 'uppercase',
                  color: '#333', marginBottom: '3px'
                }}>
                  Year
                </div>
                <select
                  key={`year-${track.id}`}
                  defaultValue={track.year ?? String(new Date().getFullYear())}
                  onChange={(e) => saveField('year', e.target.value)}
                  style={{
                    width: '100%', background: '#1a1a26',
                    border: '0.5px solid #252535', borderRadius: '5px',
                    padding: '5px 8px', color: '#c0c0d8',
                    fontSize: '12px', fontFamily: 'monospace',
                    outline: 'none', cursor: 'pointer', height: '28px',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#7f77dd')}
                  onBlur={(e) => (e.target.style.borderColor = '#252535')}
                >
                  {getYearOptions().map((year) => (
                    <option key={year} value={String(year)}>{year}</option>
                  ))}
                </select>
              </div>

            </div>
          </div>

          {/* Fixed footer */}
          <div style={{
            padding: '0 16px 16px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            flexShrink: 0
          }}>
            <Separator className="bg-[#1e1e2a]" />
            <ReadField label="Duration" value={track.duration_str} />
            <ReadField label="Format" value={track.format} />
            <ReadField label="Key full" value={track.key_full} />
            <Separator className="bg-[#1e1e2a]" />
            <div>
              <div style={{
                fontSize: '10px', fontWeight: 500,
                letterSpacing: '0.8px', textTransform: 'uppercase',
                color: '#333', marginBottom: '4px'
              }}>
                File path
              </div>
              <div style={{
                fontSize: '10px', color: '#444',
                wordBreak: 'break-all', lineHeight: 1.5
              }}>
                {track.filepath}
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}

// ─── EditField ────────────────────────────────────────────

interface EditFieldProps {
  label: string
  defaultValue: string
  onSave: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  'data-testid'?: string
}

const EditField = React.forwardRef<HTMLInputElement, EditFieldProps>(
  ({ label, defaultValue, onSave, onKeyDown, 'data-testid': testId }, ref) => (
    <div>
      <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
        {label}
      </label>
      <Input
        ref={ref}
        data-testid={testId}
        defaultValue={defaultValue}
        onBlur={(e) => onSave(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.target.select()}
        className="h-7 text-xs font-mono bg-[#1a1a26] border-[#252535] text-[#c0c0d8] focus-visible:ring-[#7f77dd]"
      />
    </div>
  )
)
EditField.displayName = 'EditField'

// ─── ReadField ────────────────────────────────────────────

function ReadField({ label, value }: { label: string; value?: string | null }): React.JSX.Element | null {
  if (!value) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{
        fontSize: '11px', fontWeight: 500,
        letterSpacing: '0.6px', textTransform: 'uppercase', color: '#444'
      }}>
        {label}
      </span>
      <span style={{ fontSize: '12px', color: '#c0c0d8' }}>{value}</span>
    </div>
  )
}
