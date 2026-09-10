import React from 'react'
import { useLibraryStore } from '../store/useLibraryStore'

// Round to whole minutes — never show seconds ticking
function formatEstimate(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  return `about ${Math.round(seconds / 60)} min`
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

interface BackgroundJobsPanelProps {
  onCancelImport: (jobId: string) => void
  onResumeImport: (jobId: string) => void
}

// Renders every job in the shared `jobs` store slice — import today, a
// 'move' variant (TODO, see useLibraryStore's JobState comment) once move
// jobs land. One panel, one visual language for "something is running in
// the background," instead of a bespoke bar per job type.
export function BackgroundJobsPanel({
  onCancelImport,
  onResumeImport
}: BackgroundJobsPanelProps): React.JSX.Element | null {
  const jobs = useLibraryStore((s) => s.jobs)
  const jobList = Object.values(jobs)

  if (jobList.length === 0) return null

  return (
    <>
      {jobList.map((job) => {
        // Only 'import' exists today — see JobState in useLibraryStore.ts.
        const pct = job.total > 0 ? Math.round((job.scanned / job.total) * 100) : 0

        return (
          <div key={job.jobId} style={{ marginBottom: '1rem' }}>
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
                {importStatusLabel(job)}
              </span>
              {job.phase === 'parsing' && (
                <button
                  onClick={() => onCancelImport(job.jobId)}
                  style={{
                    flexShrink: 0,
                    background: 'transparent',
                    border: '1px solid #33334a',
                    color: '#e8e8f0',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              )}
              {job.phase === 'cancelled' && (
                <button
                  onClick={() => onResumeImport(job.jobId)}
                  style={{
                    flexShrink: 0,
                    background: 'transparent',
                    border: '1px solid #7f77dd',
                    color: '#7f77dd',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  Resume
                </button>
              )}
            </div>
            {/* Indeterminate during the counting pass — total isn't known yet */}
            {job.phase !== 'counting' && (
              <div
                style={{
                  background: '#1e1e2a',
                  borderRadius: '4px',
                  height: '6px',
                  overflow: 'hidden'
                }}
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
      })}
    </>
  )
}
