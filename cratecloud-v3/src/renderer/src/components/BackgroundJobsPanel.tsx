import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'

// Round to whole minutes — never show seconds ticking
function formatEstimate(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  return `about ${Math.round(seconds / 60)} min`
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

function importStatusLabel(p: ImportProgressPayload): string {
  if (p.phase === 'counting') {
    return `Scanning… ${p.found} tracks found — ${p.currentFolder}`
  }
  if (p.phase === 'parsing') {
    const base = `${p.scanned} of ${p.total} · ${p.found} tracks found · Scanning ${p.currentFolder}`
    return p.estimateSeconds !== undefined
      ? `${base} · ${formatEstimate(p.estimateSeconds)} left`
      : base
  }
  if (p.phase === 'cancelled') {
    return `Cancelled — ${p.found} of ${p.total} imported`
  }
  if (p.phase === 'done') {
    return `Done — ${p.found} of ${p.total} imported`
  }
  return 'Import error'
}

function moveStatusLabel(p: MoveProgressPayload): string {
  const label = `Moving ${p.total} file${p.total !== 1 ? 's' : ''} — ${p.done} of ${p.total}`

  if (p.phase === 'cancelled') return `Cancelled — ${p.done} of ${p.total} moved`
  if (p.phase === 'done') {
    return p.failed.length > 0
      ? `Done — ${p.done - p.failed.length} moved, ${p.failed.length} failed`
      : `Done — ${p.done} moved`
  }
  if (!p.currentFile) return label

  const filename = p.currentFile.split('/').pop() ?? p.currentFile
  if (p.crossDevice && p.totalBytes > 0) {
    return `${label} · ${filename} (${formatMB(p.bytesCopied)} / ${formatMB(p.totalBytes)} MB)`
  }
  return `${label} · ${filename}`
}

function copyStatusLabel(p: CopyProgressPayload): string {
  // Same job, two labels — deleteSource is a FolderView Finder-drop (move
  // in place), unset is the EmptyView/Board copy-then-import path.
  const verb = p.deleteSource ? 'Moving' : 'Copying'
  const verbed = p.deleteSource ? 'moved' : 'copied'
  const label = `${verb} ${p.total} file${p.total !== 1 ? 's' : ''} — ${p.done} of ${p.total}`

  if (p.phase === 'cancelled') return `Cancelled — ${p.done} of ${p.total} ${verbed}`
  if (p.phase === 'done') {
    return p.failed.length > 0
      ? `Done — ${p.done - p.failed.length} ${verbed}, ${p.failed.length} failed`
      : `Done — ${p.done} ${verbed}`
  }
  if (!p.currentFile) return label

  const filename = p.currentFile.split('/').pop() ?? p.currentFile
  return p.totalBytes > 0
    ? `${label} · ${filename} (${formatMB(p.bytesCopied)} / ${formatMB(p.totalBytes)} MB)`
    : `${label} · ${filename}`
}

const cancelButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  background: 'transparent',
  border: '1px solid #33334a',
  color: '#e8e8f0',
  borderRadius: '4px',
  padding: '2px 8px',
  fontSize: '11px',
  cursor: 'pointer'
}

const resumeButtonStyle: React.CSSProperties = {
  ...cancelButtonStyle,
  border: '1px solid #7f77dd',
  color: '#7f77dd'
}

function ProgressRow({
  label,
  pct,
  showBar,
  action
}: {
  label: string
  pct: number
  showBar: boolean
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div
        style={{
          color: '#7f77dd',
          marginBottom: '4px',
          fontSize: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {action}
      </div>
      {showBar && (
        <div
          style={{ background: '#1e1e2a', borderRadius: '4px', height: '6px', overflow: 'hidden' }}
        >
          <div
            style={{
              background: '#7f77dd',
              height: '100%',
              width: `${pct}%`,
              transition: 'width 0.2s ease',
              borderRadius: '4px'
            }}
          />
        </div>
      )}
    </div>
  )
}

interface BackgroundJobsPanelProps {
  onCancelImport: (jobId: string) => void
  onResumeImport: (jobId: string) => void
  onCancelMove: (jobId: string) => void
  onCancelCopy: (jobId: string) => void
  onOpenFolder: (folderPath: string) => void
}

// Renders every job in the shared `jobs` store slice — import, move, and
// copy today. One panel, one visual language for "something is running in
// the background," instead of a bespoke bar per job type.
export function BackgroundJobsPanel({
  onCancelImport,
  onResumeImport,
  onCancelMove,
  onCancelCopy,
  onOpenFolder
}: BackgroundJobsPanelProps): React.JSX.Element | null {
  const jobs = useLibraryStore((s) => s.jobs)
  const jobList = Object.values(jobs)

  if (jobList.length === 0) return null

  return (
    <>
      {jobList.map((job) => {
        if (job.type === 'move') {
          const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0
          return (
            <ProgressRow
              key={job.jobId}
              label={moveStatusLabel(job)}
              pct={pct}
              showBar
              action={
                job.phase === 'running' ? (
                  <button onClick={() => onCancelMove(job.jobId)} style={cancelButtonStyle}>
                    Cancel
                  </button>
                ) : undefined
              }
            />
          )
        }

        if (job.type === 'copy') {
          const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0
          return (
            <ProgressRow
              key={job.jobId}
              label={copyStatusLabel(job)}
              pct={pct}
              showBar
              action={
                job.phase === 'running' ? (
                  <button onClick={() => onCancelCopy(job.jobId)} style={cancelButtonStyle}>
                    Cancel
                  </button>
                ) : undefined
              }
            />
          )
        }

        // 'import'
        const pct = job.total > 0 ? Math.round((job.scanned / job.total) * 100) : 0
        return (
          <ProgressRow
            key={job.jobId}
            label={importStatusLabel(job)}
            pct={pct}
            showBar={job.phase !== 'counting'}
            action={
              job.phase === 'parsing' ? (
                <button onClick={() => onCancelImport(job.jobId)} style={cancelButtonStyle}>
                  Cancel
                </button>
              ) : job.phase === 'cancelled' ? (
                <button onClick={() => onResumeImport(job.jobId)} style={resumeButtonStyle}>
                  Resume
                </button>
              ) : job.phase === 'done' ? (
                <button onClick={() => onOpenFolder(job.folderPath)} style={resumeButtonStyle}>
                  Open folder
                </button>
              ) : undefined
            }
          />
        )
      })}
    </>
  )
}
