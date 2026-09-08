import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'

// Updated View type — add dashboard, genre, artist, crates
type View = 'dashboard' | 'library' | 'board' | 'genre' | 'artist' | 'folders' | 'crates' | 'settings'

interface SidebarProps {
  activeView: View
  onViewChange: (view: View) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenSettings: () => void
}

export function Sidebar({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapsed,
  onOpenSettings,
}: SidebarProps): React.JSX.Element {
  const { tracks } = useLibraryStore()

  const navItem = (
    view: View,
    label: string,
    icon: string,
    count?: number
  ): React.JSX.Element => {
    const isActive = activeView === view
    return (
      <button
        onClick={() => onViewChange(view)}
        title={collapsed ? label : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          width: '100%',
          padding: collapsed ? '7px 0' : '7px 12px',
          background: isActive ? '#1a1a26' : 'none',
          border: 'none',
          borderRadius: '6px',
          color: isActive ? '#a09be8' : '#666',
          fontSize: '13px',
          cursor: 'pointer',
          textAlign: 'left',
          borderRight: isActive
            ? '2px solid #7f77dd'
            : '2px solid transparent',
        }}
      >
        {collapsed ? (
          <span>{icon}</span>
        ) : (
          <>
            <span>{label}</span>
            {count !== undefined && (
              <span style={{
                fontSize: '11px',
                background: '#1e1e2a',
                padding: '1px 6px',
                borderRadius: '10px',
                color: '#444',
              }}>
                {count}
              </span>
            )}
          </>
        )}
      </button>
    )
  }

  const separator = (): React.JSX.Element => (
    <div style={{
      height: '0.5px',
      background: '#1e1e2a',
      margin: '6px 4px',
    }} />
  )

  const sectionLabel = (label: string): React.JSX.Element | null => collapsed ? null : (
    <p style={{
      fontSize: '10px',
      fontWeight: 500,
      letterSpacing: '1px',
      textTransform: 'uppercase',
      color: '#333',
      margin: '0',
      padding: '6px 12px 4px',
    }}>
      {label}
    </p>
  )

  return (
    <div style={{
      width: collapsed ? '48px' : '200px',
      flexShrink: 0,
      background: '#12121a',
      borderRight: '0.5px solid #1e1e2a',
      padding: '12px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      transition: 'width 0.15s ease',
    }}>

      {/* Collapse toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: '4px 4px 8px',
      }}>
        {!collapsed && (
          <p style={{
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '1px',
            textTransform: 'uppercase',
            color: '#333',
            margin: 0,
          }}>
            CrateCloud
          </p>
        )}
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'none',
            border: 'none',
            color: '#444',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '2px 4px',
            lineHeight: 1
          }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* ── Browse section ───────────────────────── */}
      {sectionLabel('Browse')}

      {navItem('dashboard', 'Overview', '◉')}
      {navItem('library', 'All tracks', '♫', tracks.length)}
      {navItem('genre', 'Genres', '◈')}
      {navItem('artist', 'Artists', '♪')}
      {navItem('folders', 'Folders', '⊟')}
      {navItem('crates', 'Crates', '◫')}

      {/* ── Workflow section ─────────────────────── */}
      {separator()}
      {sectionLabel('Workflow')}

      {navItem('board', 'Board view', '▤')}

      {/* Push settings to bottom */}
      <div style={{ flex: 1 }} />

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        title={collapsed ? 'Settings' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: '8px',
          width: '100%',
          padding: collapsed ? '7px 0' : '7px 12px',
          background: activeView === 'settings' ? '#1a1a26' : 'none',
          border: 'none',
          borderRadius: '6px',
          color: activeView === 'settings' ? '#a09be8' : '#555',
          fontSize: '13px',
          cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        <span>⚙</span>
        {!collapsed && <span>Settings</span>}
      </button>
    </div>
  )
}

export type { View }
