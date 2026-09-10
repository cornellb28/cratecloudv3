import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { Badge } from '@renderer/components/ui/badge'
import { useArtworkUrl } from '../hooks/useArtworkUrl'

interface DashboardStats {
  total: number
  analyzed: number
  missing: number
  noBpm: number
  noKey: number
  noArtwork: number
  noGenre: number
  totalDurationHr: number
  topTags: { value: string; color: string; count: number }[]
  topGenres: { genre: string; count: number }[]
  recentTracks: Track[]
}

function computeStats(tracks: Track[], trackTags: Map<number, Tag[]>): DashboardStats {
  const analyzed = tracks.filter((t) => t.analyzed_at !== null).length
  const missing = tracks.filter((t) => t.missing === 1).length
  const noBpm = tracks.filter((t) => !t.bpm).length
  const noKey = tracks.filter((t) => !t.key_camelot).length
  const noArtwork = tracks.filter((t) => !t.artwork_hash).length
  const noGenre = tracks.filter((t) => !t.genre).length
  const totalDurationHr = Math.round(
    tracks.reduce((sum, t) => sum + (t.duration_sec ?? 0), 0) / 3600
  )

  // Top comment tags
  const tagCounts = new Map<number, { value: string; color: string; count: number }>()
  trackTags.forEach(tags => {
    tags.filter(t => t.field === 'comment').forEach(tag => {
      const existing = tagCounts.get(tag.id)
      if (existing) existing.count++
      else tagCounts.set(tag.id, { value: tag.value, color: tag.color, count: 1 })
    })
  })
  const topTags = Array.from(tagCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // Top genres
  const genreCounts = new Map<string, number>()
  tracks.forEach(t => {
    if (t.genre) {
      genreCounts.set(t.genre, (genreCounts.get(t.genre) ?? 0) + 1)
    }
  })
  const topGenres = Array.from(genreCounts.entries())
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // Recently added
  const recentTracks = [...tracks]
    .sort((a, b) => b.added_at.localeCompare(a.added_at))
    .slice(0, 8)

  return {
    total: tracks.length,
    analyzed,
    missing,
    noBpm,
    noKey,
    noArtwork,
    noGenre,
    totalDurationHr,
    topTags,
    topGenres,
    recentTracks,
  }
}

export function DashboardView(): React.JSX.Element {
  const { tracks, trackTags } = useLibraryStore()
  const stats = computeStats(tracks, trackTags)

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '24px 32px',
      maxWidth: '100%',
      width: '100%',
      margin: '0 auto',
    }}>

      <h1 style={{
        fontSize: '20px',
        fontWeight: 500,
        color: '#e8e8f0',
        marginBottom: '24px',
      }}>
        Library Overview
      </h1>

      {/* ── Row 1 — Overview metrics ──────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '10px',
        marginBottom: '24px',
      }}>
        {[
          {
            label: 'Total tracks',
            value: stats.total.toLocaleString(),
            color: '#7f77dd',
          },
          {
            label: 'Analyzed',
            value: stats.analyzed.toLocaleString(),
            sub: `${Math.round(stats.analyzed / stats.total * 100)}%`,
            color: '#1d9e75',
          },
          {
            label: 'Missing files',
            value: stats.missing.toLocaleString(),
            color: stats.missing > 0 ? '#d85a30' : '#555',
          },
          {
            label: 'Total duration',
            value: `${stats.totalDurationHr}h`,
            color: '#378add',
          },
        ].map(metric => (
          <div
            key={metric.label}
            style={{
              background: '#13131b',
              border: '0.5px solid #1e1e2a',
              borderRadius: '10px',
              padding: '16px',
            }}
          >
            <div style={{
              fontSize: '11px',
              color: '#444',
              marginBottom: '6px',
              fontWeight: 500,
              letterSpacing: '0.6px',
              textTransform: 'uppercase',
            }}>
              {metric.label}
            </div>
            <div style={{
              fontSize: '24px',
              fontWeight: 500,
              color: metric.color,
              lineHeight: 1,
            }}>
              {metric.value}
            </div>
            {metric.sub && (
              <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>
                {metric.sub} complete
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Row 2 — Needs attention ───────────────── */}
      <SectionTitle>Needs attention</SectionTitle>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '10px',
        marginBottom: '24px',
      }}>
        {[
          { label: 'Without BPM', value: stats.noBpm, color: '#ba7517' },
          { label: 'Without key', value: stats.noKey, color: '#ba7517' },
          { label: 'Without artwork', value: stats.noArtwork, color: '#ba7517' },
          { label: 'Without genre', value: stats.noGenre, color: '#ba7517' },
        ].map(item => (
          <div
            key={item.label}
            style={{
              background: '#13131b',
              border: item.value > 0
                ? '0.5px solid #ba751733'
                : '0.5px solid #1e1e2a',
              borderRadius: '10px',
              padding: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{
              fontSize: '20px',
              fontWeight: 500,
              color: item.value > 0 ? item.color : '#1d9e75',
              minWidth: '40px',
            }}>
              {item.value > 0 ? item.value.toLocaleString() : '✓'}
            </div>
            <div style={{ fontSize: '12px', color: '#555' }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Row 3 — Tags + Genres ────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px',
        marginBottom: '24px',
      }}>

        {/* Top comment tags */}
        <div style={{
          background: '#13131b',
          border: '0.5px solid #1e1e2a',
          borderRadius: '10px',
          padding: '16px',
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 500,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color: '#444',
            marginBottom: '12px',
          }}>
            Most used tags
          </div>
          {stats.topTags.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#333' }}>
              No tags applied yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {stats.topTags.map(tag => (
                <Badge
                  key={tag.value}
                  variant="outline"
                  style={{
                    background: tag.color + '22',
                    color: tag.color,
                    borderColor: tag.color + '44',
                    fontSize: '11px',
                  }}
                >
                  {tag.value}
                  <span style={{
                    marginLeft: '5px',
                    fontSize: '10px',
                    opacity: 0.7,
                  }}>
                    {tag.count}
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Genre distribution */}
        <div style={{
          background: '#13131b',
          border: '0.5px solid #1e1e2a',
          borderRadius: '10px',
          padding: '16px',
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 500,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color: '#444',
            marginBottom: '12px',
          }}>
            Genre distribution
          </div>
          {stats.topGenres.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#333' }}>
              No genres tagged yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {stats.topGenres.map(g => {
                const pct = Math.round(g.count / stats.total * 100)
                return (
                  <div key={g.genre}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '3px',
                    }}>
                      <span style={{ fontSize: '11px', color: '#c0c0d8' }}>
                        {g.genre}
                      </span>
                      <span style={{ fontSize: '11px', color: '#444' }}>
                        {g.count}
                      </span>
                    </div>
                    <div style={{
                      background: '#1e1e2a',
                      borderRadius: '2px',
                      height: '3px',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: '#7f77dd',
                        borderRadius: '2px',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 4 — Recently added ────────────────── */}
      <SectionTitle>Recently added</SectionTitle>
      <div style={{
        background: '#13131b',
        border: '0.5px solid #1e1e2a',
        borderRadius: '10px',
        overflow: 'hidden',
      }}>
        {stats.recentTracks.map((track, i) => (
          <RecentTrackRow
            key={track.id}
            track={track}
            index={i}
            isLast={i === stats.recentTracks.length - 1}
          />
        ))}
      </div>

    </div>
  )
}

// ─── Helper ───────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{
      fontSize: '11px',
      fontWeight: 500,
      letterSpacing: '0.8px',
      textTransform: 'uppercase',
      color: '#444',
      marginBottom: '10px',
    }}>
      {children}
    </div>
  )
}

function RecentTrackRow({
  track,
  index,
  isLast,
}: {
  track: Track
  index: number
  isLast: boolean
}): React.JSX.Element {
  const artworkUrl = useArtworkUrl(track.artwork_hash, 'thumb')

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 14px',
        borderBottom: isLast ? 'none' : '0.5px solid #1e1e2a',
      }}
    >
      {/* Track number */}
      <span style={{
        fontSize: '11px',
        color: '#333',
        minWidth: '20px',
        textAlign: 'right',
      }}>
        {index + 1}
      </span>

      {/* Artwork */}
      <div style={{
        width: '36px',
        height: '36px',
        borderRadius: '4px',
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
          <span style={{ fontSize: '14px', color: '#333' }}>♪</span>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 500,
          color: '#e0e0f0',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {track.title ?? track.filename ?? 'Untitled'}
        </div>
        <div style={{
          fontSize: '11px',
          color: '#555',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {track.artist ?? 'Unknown'}
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        {track.bpm && (
          <Badge variant="outline" style={{
            fontSize: '10px',
            background: '#1a2535',
            color: '#5d9fd8',
            borderColor: '#1a2535',
          }}>
            {track.bpm}
          </Badge>
        )}
        {track.key_camelot && (
          <Badge variant="outline" style={{
            fontSize: '10px',
            background: '#1a2830',
            color: '#3db88a',
            borderColor: '#1a2830',
          }}>
            {track.key_camelot}
          </Badge>
        )}
      </div>

      {/* Added date */}
      <span style={{
        fontSize: '11px',
        color: '#333',
        flexShrink: 0,
      }}>
        {new Date(track.added_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}
      </span>
    </div>
  )
}
