import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'
import { TrackRow } from '../components/TrackRow'

export function LibraryView(): React.JSX.Element {
  const { tracks, searchQuery } = useLibraryStore()

  const query = searchQuery.trim().toLowerCase()
  const filteredTracks = query
    ? tracks.filter((track) => {
        const haystack = [
          track.title,
          track.artist,
          track.bpm,
          track.key_camelot,
          track.camelot
        ]
          .filter((value) => value !== null && value !== undefined)
          .join(' ')
          .toLowerCase()
        return haystack.includes(query)
      })
    : tracks

  if (tracks.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#333',
        fontSize: '14px',
      }}>
        No tracks yet — import a folder to get started
      </div>
    )
  }

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '8px 16px',
    }}>
      {filteredTracks.map((track) => (
        <TrackRow key={track.id} track={track} />
      ))}
    </div>
  )
}
