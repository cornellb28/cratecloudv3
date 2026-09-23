import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AuthPanel } from './AuthPanel'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { ReconciliationModal } from './ReconciliationModal'
import { SeratoImportConfirmDialog } from './SeratoImportConfirmDialog'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  libraryRoots: LibraryRoot[]
  onRootsChanged: () => void
  // Passed down rather than fetched here so there is one source of auth
  // truth in the app (App.tsx's auth:changed subscription) instead of two
  // that can disagree.
  // Nullable: there is no auth gate, so Settings can be opened before the
  // stored session has finished restoring, and stays open when signed out.
  auth: AuthState | null
  onAuthChanged: (state: AuthState) => void
}

const SERATO_OVERRIDE_KEY = 'serato_library_override'
const SERATO_OVERWRITE_KEY = 'serato_overwrite_existing'

// Surfaces `status` whenever it is not a plain 'active', so a subscription
// that has gone past_due or been cancelled says so here rather than reading
// as a healthy plan. Nothing in the desktop app gates on any of this — the
// desktop app is free — but a DJ paying for cloud sync should be able to see
// that their card needs attention without opening the website.
// Where "Upgrade" points. Unset (the default today) renders the section as
// "coming soon" with the button disabled, rather than opening a dead link —
// the payments website does not exist yet. Set RENDERER_VITE_UPGRADE_URL in
// .env to turn it into a real link; see .env.example.
const UPGRADE_URL = import.meta.env.RENDERER_VITE_UPGRADE_URL

// Advertising, not gating. Nothing in the desktop app is locked — this
// describes the paid cloud surface, which is sold on the web and does not
// exist yet. There is deliberately no LockedView/LockBadge anywhere.
function UpgradeSection({
  entitlement
}: {
  entitlement: Entitlement | null
}): React.JSX.Element | null {
  // Already subscribed — nothing to sell.
  if (entitlement?.plan === 'sync') return null

  return (
    <div
      style={{
        marginTop: '14px',
        padding: '12px',
        background: '#16161f',
        border: '0.5px solid #252535',
        borderRadius: '6px'
      }}
    >
      <div style={{ fontSize: '12px', color: '#c0c0d8', marginBottom: '4px' }}>Cloud Sync</div>
      <div style={{ fontSize: '11px', color: '#555', lineHeight: 1.6, marginBottom: '10px' }}>
        Keep your tags, crates and play history in sync across every machine — and browse them on
        your phone when mobile lands. Your audio files stay where they are.
      </div>

      <Button
        onClick={() => UPGRADE_URL && void window.api.openExternal(UPGRADE_URL)}
        disabled={!UPGRADE_URL}
        variant="outline"
        size="sm"
      >
        {UPGRADE_URL ? 'See plans' : 'Coming soon'}
      </Button>
    </div>
  )
}

function formatPlan(e: Entitlement): string {
  const seats = e.seats > 1 ? ` · ${e.seats} seats` : ''
  const trailing =
    e.cancel_at_period_end && e.current_period_end
      ? ` · ends ${new Date(e.current_period_end).toLocaleDateString()}`
      : ''
  const health = e.status === 'active' ? '' : ` · ${e.status.replace(/_/g, ' ')}`
  return `${e.plan} plan${seats}${health}${trailing}`
}

export function SettingsModal({
  open,
  onClose,
  libraryRoots,
  onRootsChanged,
  auth,
  onAuthChanged
}: SettingsModalProps): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [seratoImportPrompt, setSeratoImportPrompt] = useState<{
    folderPath: string
    seratoDir: string
  } | null>(null)
  const [seratoOverride, setSeratoOverride] = useState<string | null>(null)
  const [overwriteExisting, setOverwriteExisting] = useState(true)

  // Loaded once when the modal opens rather than on mount — settings rarely
  // change while it's closed, and this avoids an IPC round trip the app
  // never otherwise needs (nothing else reads these two keys).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      window.api.settings.get(SERATO_OVERRIDE_KEY),
      window.api.settings.get(SERATO_OVERWRITE_KEY)
    ]).then(([override, overwrite]) => {
      if (cancelled) return
      setSeratoOverride(override || null)
      setOverwriteExisting(overwrite !== 'false')
    })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleChooseSeratoFolder(): Promise<void> {
    const folderPath = await window.api.openFolder()
    if (!folderPath) return
    await window.api.settings.set(SERATO_OVERRIDE_KEY, folderPath)
    setSeratoOverride(folderPath)
  }

  async function handleClearSeratoFolder(): Promise<void> {
    await window.api.settings.set(SERATO_OVERRIDE_KEY, '')
    setSeratoOverride(null)
  }

  async function handleToggleOverwrite(): Promise<void> {
    const next = !overwriteExisting
    setOverwriteExisting(next)
    await window.api.settings.set(SERATO_OVERWRITE_KEY, String(next))
  }

  async function addRoot(folderPath: string, importSeratoData: boolean): Promise<void> {
    setAdding(true)
    await window.api.roots.add(folderPath, importSeratoData)
    setAdding(false)
    onRootsChanged()
  }

  async function handleAddFolder(): Promise<void> {
    const folderPath = await window.api.openFolder()
    if (!folderPath) return

    const detection = await window.api.detectSeratoForFolder(folderPath)
    if (detection.found && detection.seratoDir) {
      setSeratoImportPrompt({ folderPath, seratoDir: detection.seratoDir })
      return
    }
    await addRoot(folderPath, false)
  }

  // Closes the modal on the way out: App.tsx swaps the whole shell for the
  // login view, and leaving a dialog mounted over it would strand it there.
  async function handleSignOut(): Promise<void> {
    setSigningOut(true)
    try {
      const result = await window.api.auth.signOut()
      onClose()
      onAuthChanged(result.state)
    } finally {
      setSigningOut(false)
    }
  }

  // Walks every registered root and reconciles the DB against what is
  // actually on disk. Per-root progress rides the normal import:progress
  // channel, so the BackgroundJobsPanel already shows it — this only needs
  // to summarise the outcome once the whole pass is done.
  async function handleRescan(): Promise<void> {
    setRescanning(true)
    try {
      const result = await window.api.rescanLibrary()
      if (!result.ok) {
        toast.error('Rescan failed', { description: result.error })
        return
      }

      const parts: string[] = []
      if (result.imported) parts.push(`${result.imported} checked`)
      if (result.relinked) parts.push(`${result.relinked} relinked`)
      // Deliberately worded "missing", not "removed" — nothing was deleted.
      if (result.swept) parts.push(`${result.swept} now missing`)
      if (result.skippedRoots?.length) {
        parts.push(`${result.skippedRoots.join(', ')} offline \u2014 skipped`)
      }

      toast.success(`Rescanned ${result.roots} folder${result.roots === 1 ? '' : 's'}`, {
        description: parts.length > 0 ? parts.join(' \u00b7 ') : 'Nothing changed.'
      })
      onRootsChanged()
    } finally {
      setRescanning(false)
    }
  }

  async function handleRemove(id: number): Promise<void> {
    await window.api.roots.remove(id)
    onRootsChanged()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        style={{
          background: '#13131b',
          border: '0.5px solid #1e1e2a',
          borderRadius: '12px',
          maxWidth: '440px',
          width: '100%',
          color: '#e8e8f0',
          fontFamily: 'inherit',
          padding: '0'
        }}
      >
        <div style={{ padding: '16px', borderBottom: '0.5px solid #1e1e2a' }}>
          <div style={{ fontSize: '15px', fontWeight: 500 }}>Settings</div>
        </div>

        <div style={{ padding: '16px', borderBottom: '0.5px solid #1e1e2a' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: '#444',
              marginBottom: '10px'
            }}
          >
            Account
          </div>

          {auth === null || auth.user === null ? (
            <>
              <div
                style={{ fontSize: '11px', color: '#555', marginBottom: '12px', lineHeight: 1.5 }}
              >
                CrateCloud is free and works without an account. Sign in only if you want Cloud Sync
                across your machines.
              </div>
              <AuthPanel
                configured={auth?.configured ?? false}
                persistent={auth?.persistent ?? false}
                onSignedIn={onAuthChanged}
              />
            </>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#c0c0d8',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {auth.user.email ?? 'Signed in'}
                  </div>
                  {/* Shown for transparency, not to gate anything: the
                      desktop app is free. Once the Stripe webhook exists
                      this is where a purchased plan will show up. */}
                  <div style={{ fontSize: '10px', color: '#444' }}>
                    {auth.entitlement ? formatPlan(auth.entitlement) : 'plan unknown'}
                  </div>
                </div>

                <Button
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  variant="outline"
                  size="sm"
                >
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </Button>
              </div>

              <UpgradeSection entitlement={auth.entitlement} />
            </>
          )}
        </div>

        <div style={{ padding: '16px' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: '#444',
              marginBottom: '10px'
            }}
          >
            Library folders
          </div>

          {libraryRoots.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#444', marginBottom: '12px' }}>
              No folders registered yet.
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}
            >
              {libraryRoots.map((root) => (
                <div
                  key={root.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '8px 10px',
                    background: '#1a1a26',
                    border: '0.5px solid #252535',
                    borderRadius: '6px'
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: '#c0c0d8' }}>{root.name}</div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#444',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {root.path}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(root.id)}
                    title="Remove folder"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#555',
                      cursor: 'pointer',
                      fontSize: '13px',
                      flexShrink: 0
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button onClick={handleAddFolder} disabled={adding} variant="outline" size="sm">
              {adding ? 'Adding...' : '+ Add library folder'}
            </Button>

            <Button
              onClick={() => void handleRescan()}
              disabled={rescanning || libraryRoots.length === 0}
              variant="outline"
              size="sm"
              title="Check every library folder against what is on disk. Nothing is deleted — files that have gone are marked missing."
            >
              {rescanning ? 'Rescanning...' : '↺ Rescan Library'}
            </Button>
          </div>
        </div>
        <div style={{ padding: '16px', borderBottom: '0.5px solid #1e1e2a' }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReconcileOpen(true)}
            className="text-xs"
          >
            Review pending changes
          </Button>

          <ReconciliationModal open={reconcileOpen} onClose={() => setReconcileOpen(false)} />
          <SeratoImportConfirmDialog
            open={seratoImportPrompt !== null}
            seratoDir={seratoImportPrompt?.seratoDir ?? ''}
            onCancel={() => setSeratoImportPrompt(null)}
            onConfirm={(importSeratoData) => {
              const folderPath = seratoImportPrompt?.folderPath
              setSeratoImportPrompt(null)
              if (folderPath) void addRoot(folderPath, importSeratoData)
            }}
          />
        </div>

        <div style={{ padding: '16px' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: '#444',
              marginBottom: '10px'
            }}
          >
            Serato export
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: '#c0c0d8', marginBottom: '4px' }}>
              Serato library location
            </div>
            <div style={{ fontSize: '10px', color: '#444', marginBottom: '8px' }}>
              {seratoOverride
                ? seratoOverride
                : 'Default — ~/Music/_Serato_ (or the volume root for tracks on another drive)'}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Button
                onClick={() => void handleChooseSeratoFolder()}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                Choose folder…
              </Button>
              {seratoOverride && (
                <Button
                  onClick={() => void handleClearSeratoFolder()}
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  style={{ color: '#555' }}
                >
                  Reset to default
                </Button>
              )}
            </div>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: '#c0c0d8',
              cursor: 'pointer'
            }}
          >
            <div
              onClick={() => void handleToggleOverwrite()}
              style={{
                width: '30px',
                height: '17px',
                borderRadius: '10px',
                background: overwriteExisting ? '#7f77dd' : '#252535',
                position: 'relative',
                flexShrink: 0,
                transition: 'background 0.15s'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: overwriteExisting ? '15px' : '2px',
                  width: '13px',
                  height: '13px',
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.15s'
                }}
              />
            </div>
            Overwrite existing crate of the same name
          </label>
        </div>
      </DialogContent>
    </Dialog>
  )
}
