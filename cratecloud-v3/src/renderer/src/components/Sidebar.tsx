import { useLibraryStore } from '../store/useLibraryStore'

// The views a DJ cab navigate between
type View = 'library' | 'board'

interface SidebarProps {
  activeView: View
  onViewChange: (view: View) => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  const { tracks } = useLibraryStore()

  const navItem = (view: View, label: string, count?: number): React.JSX.Element => {
    const isActive = activeView === view

    return (
      <button
        onClick={() => onViewChange(view)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '7px 12px',
          background: isActive ? '#1a1a26' : 'none',
          border: 'none',
          borderRadius: '6px',
          color: isActive ? '#a09be8' : '#666',
          fontSize: '13px',
          cursor: 'pointer',
          textAlign: 'left',
          borderRight: isActive ? '2px solid #7f77dd' : '2px solid transparent'
        }}
      >
        <span>{label}</span>
        {count !== undefined && (
          <span
            style={{
              fontSize: '11px',
              background: '#1e1e2a',
              padding: '1px 6px',
              borderRadius: '10px',
              color: '#444'
            }}
          >
            {count}
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      style={{
        width: '200px',
        flexShrink: 0,
        background: '#12121a',
        borderRight: '0.5px solid #1e1e2a',
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px'
      }}
    >
      <p
        style={{
          fontSize: '10px',
          fontWeight: 500,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          color: '#333',
          padding: '8px 12px 4px'
        }}
      >
        Library
      </p>

      {navItem('library', 'All tracks', tracks.length)}
      {navItem('board', 'Board view')}
    </div>
  )
}
