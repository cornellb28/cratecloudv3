import React, { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'

interface FolderNode {
  name: string
  path: string
  children: FolderNode[]
  expanded: boolean
  loading: boolean
}

interface FolderTreeDropdownProps {
  onSelect: (path: string, name: string) => void
  onClose: () => void
  anchor: { top: number; left: number; width: number }
}

export function FolderTreeDropdown({
  onSelect,
  onClose,
  anchor
}: FolderTreeDropdownProps): React.JSX.Element {
  const [roots, setRoots] = useState<FolderNode[]>([])
  const [loading, setLoading] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)

  // "New folder" inline input — one active at a time, keyed by the parent
  // directory it would be created under.
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // Load library roots on mount
  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true)
      const registeredRoots = await window.api.roots.all()
      setRoots(
        registeredRoots.map((r) => ({
          name: r.name,
          path: r.path,
          children: [],
          expanded: false,
          loading: false
        }))
      )
      setLoading(false)
    }
    load()
  }, [])

  // Close on click outside
  useEffect(() => {
    function handle(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  // Load subfolders for a node
  async function loadChildren(node: FolderNode): Promise<FolderNode[]> {
    const result = await window.api.fs.readFolder(node.path)
    if (!result.ok || !result.items) return []
    return result.items
      .filter((i) => i.isDirectory)
      .map((i) => ({
        name: i.name,
        path: i.path,
        children: [],
        expanded: false,
        loading: false
      }))
  }

  // Toggle expand/collapse
  async function toggleNode(
    nodes: FolderNode[],
    setNodes: (n: FolderNode[]) => void,
    path: string
  ): Promise<void> {
    const updated = await Promise.all(
      nodes.map(async (node) => {
        if (node.path === path) {
          if (node.expanded) {
            return { ...node, expanded: false }
          }
          if (node.children.length === 0) {
            const children = await loadChildren(node)
            return { ...node, expanded: true, children, loading: false }
          }
          return { ...node, expanded: true }
        }
        if (node.children.length > 0) {
          return {
            ...node,
            children: await updateChildren(node.children, path)
          }
        }
        return node
      })
    )
    setNodes(updated)
  }

  async function updateChildren(nodes: FolderNode[], path: string): Promise<FolderNode[]> {
    return Promise.all(
      nodes.map(async (node) => {
        if (node.path === path) {
          if (node.expanded) {
            return { ...node, expanded: false }
          }
          if (node.children.length === 0) {
            const children = await loadChildren(node)
            return { ...node, expanded: true, children }
          }
          return { ...node, expanded: true }
        }
        if (node.children.length > 0) {
          return {
            ...node,
            children: await updateChildren(node.children, path)
          }
        }
        return node
      })
    )
  }

  // Create a folder under parentPath, then select it immediately — the
  // dropdown exists to pick a move destination, so a freshly created
  // folder becomes that destination rather than requiring a second pick.
  async function handleCreate(parentPath: string): Promise<void> {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const result = await window.api.fs.createFolder(parentPath, name)
      if (result.ok && result.path) {
        if (result.folderId === null) {
          toast.warning(`Created "${name}"`, { description: result.reason })
        } else {
          toast.success(`Created "${name}"`)
        }
        setCreatingIn(null)
        setNewName('')
        onSelect(result.path, name)
      } else {
        toast.error('Could not create folder', { description: result.error ?? 'Unknown error' })
      }
    } catch (err) {
      toast.error('Could not create folder', { description: (err as Error).message })
    }
    setCreating(false)
  }

  function renderNode(node: FolderNode, depth: number = 0): React.JSX.Element {
    return (
      <div key={node.path}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: `5px 10px 5px ${10 + depth * 14}px`,
            cursor: 'pointer',
            fontSize: '12px',
            color: '#c0c0d8',
            userSelect: 'none',
            transition: 'background 0.1s'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#252535')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {/* Expand toggle */}
          <span
            onClick={() => toggleNode(roots, setRoots, node.path)}
            style={{
              fontSize: '10px',
              color: '#555',
              width: '12px',
              flexShrink: 0,
              transform: node.expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
              display: 'inline-block'
            }}
          >
            ›
          </span>

          {/* Folder icon + name */}
          <span
            onClick={() => onSelect(node.path, node.name)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span style={{ fontSize: '13px' }}>{depth === 0 ? '💿' : '⊟'}</span>
            {node.name}
          </span>
        </div>

        {/* Children */}
        {node.expanded && node.children.length > 0 && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}

        {/* New folder — inline input, or the row that opens it */}
        {node.expanded &&
          (creatingIn === node.path ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: `4px 10px 4px ${10 + (depth + 1) * 14}px`
              }}
            >
              <input
                autoFocus
                value={newName}
                disabled={creating}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate(node.path)
                  if (e.key === 'Escape') {
                    setCreatingIn(null)
                    setNewName('')
                  }
                }}
                placeholder="Folder name"
                style={{
                  flex: 1,
                  background: '#0e0e12',
                  border: '0.5px solid #333',
                  borderRadius: '4px',
                  color: '#e8e8f0',
                  fontSize: '11px',
                  padding: '3px 6px',
                  fontFamily: 'inherit'
                }}
              />
              <span
                onClick={() => void handleCreate(node.path)}
                style={{ fontSize: '12px', color: '#1d9e75', cursor: 'pointer', padding: '0 2px' }}
              >
                ✓
              </span>
              <span
                onClick={() => {
                  setCreatingIn(null)
                  setNewName('')
                }}
                style={{ fontSize: '12px', color: '#555', cursor: 'pointer', padding: '0 2px' }}
              >
                ×
              </span>
            </div>
          ) : (
            <div
              onClick={() => {
                setCreatingIn(node.path)
                setNewName('')
              }}
              style={{
                padding: `4px 10px 4px ${10 + (depth + 1) * 14}px`,
                fontSize: '11px',
                color: '#555',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#a09be8')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
            >
              + New folder
            </div>
          ))}
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        top: anchor.top,
        left: anchor.left,
        width: Math.max(anchor.width, 240),
        background: '#1a1a26',
        border: '0.5px solid #252535',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 1000,
        maxHeight: '320px',
        overflowY: 'auto'
      }}
    >
      {loading ? (
        <div
          style={{
            padding: '16px',
            fontSize: '12px',
            color: '#444',
            textAlign: 'center'
          }}
        >
          Loading folders...
        </div>
      ) : roots.length === 0 ? (
        <div
          style={{
            padding: '16px',
            fontSize: '12px',
            color: '#444',
            textAlign: 'center'
          }}
        >
          No library roots registered
        </div>
      ) : (
        roots.map((root) => renderNode(root, 0))
      )}
    </div>
  )
}
