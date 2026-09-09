import React, { useState, useEffect, useRef } from 'react'

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
  anchor,
}: FolderTreeDropdownProps): React.JSX.Element {
  const [roots, setRoots] = useState<FolderNode[]>([])
  const [loading, setLoading] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Load library roots on mount
  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true)
      const registeredRoots = await window.api.roots.all()
      setRoots(registeredRoots.map((r) => ({
        name: r.name,
        path: r.path,
        children: [],
        expanded: false,
        loading: false,
      })))
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
  async function toggleNode(nodes: FolderNode[], setNodes: (n: FolderNode[]) => void, path: string): Promise<void> {
    const updated = await Promise.all(nodes.map(async (node) => {
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
          children: await updateChildren(node.children, path),
        }
      }
      return node
    }))
    setNodes(updated)
  }

  async function updateChildren(
    nodes: FolderNode[],
    path: string
  ): Promise<FolderNode[]> {
    return Promise.all(nodes.map(async node => {
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
          children: await updateChildren(node.children, path),
        }
      }
      return node
    }))
  }

  function renderNode(
    node: FolderNode,
    depth: number = 0
  ): React.JSX.Element {
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
            transition: 'background 0.1s',
          }}
          onMouseEnter={e =>
            e.currentTarget.style.background = '#252535'
          }
          onMouseLeave={e =>
            e.currentTarget.style.background = 'transparent'
          }
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
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '13px' }}>
              {depth === 0 ? '💿' : '⊟'}
            </span>
            {node.name}
          </span>
        </div>

        {/* Children */}
        {node.expanded && node.children.length > 0 && (
          <div>
            {node.children.map(child =>
              renderNode(child, depth + 1)
            )}
          </div>
        )}

        {/* No subfolders message */}
        {node.expanded && node.children.length === 0 && (
          <div style={{
            padding: `4px 10px 4px ${10 + (depth + 1) * 14}px`,
            fontSize: '11px',
            color: '#333'
          }}>
            No subfolders
          </div>
        )}
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
        <div style={{
          padding: '16px',
          fontSize: '12px',
          color: '#444',
          textAlign: 'center'
        }}>
          Loading folders...
        </div>
      ) : roots.length === 0 ? (
        <div style={{
          padding: '16px',
          fontSize: '12px',
          color: '#444',
          textAlign: 'center'
        }}>
          No library roots registered
        </div>
      ) : (
        roots.map((root) => renderNode(root, 0))
      )}
    </div>
  )
}
