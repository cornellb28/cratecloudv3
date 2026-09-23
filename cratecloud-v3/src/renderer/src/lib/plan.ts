// ── Plan / tier wording ───────────────────────────────────────────────────
// Turns an `entitlements` row into the words the Account page shows.
//
// Read-only on purpose. The desktop app is free and gates nothing, and
// plan/status are written only by the payments website's Stripe webhook —
// so this module describes what the row says and never decides what the DJ
// may do. In particular it deliberately does NOT reimplement the
// entitlement rule (status + current_period_end), which lives in exactly
// one place on the website's server.

export interface PlanSummary {
  // The tier name as the DJ should read it: 'Free' or 'Cloud Sync'.
  name: string
  // One supporting line under the name.
  tagline: string
  // Set only when the subscription is not simply healthy, or is ending.
  note: string | null
  // What this tier gets you.
  includes: string[]
  // True for the paid cloud tier. Styling only — never a gate.
  paid: boolean
}

// Everything on this list is in the free desktop app, for everyone. It is
// here so the Account page can say what the DJ already has rather than only
// what they could buy.
const FREE_INCLUDES = [
  'Unlimited tracks, crates and tags',
  'BPM and key analysis',
  'Serato import and .crate export'
]

const SYNC_INCLUDES = [
  ...FREE_INCLUDES,
  'Tags, crates and boards synced across your machines',
  'Browse and tag from the mobile app'
]

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// A subscription's health, in a DJ's words rather than Stripe's. Returns
// null when there is nothing worth saying.
function syncNote(e: Entitlement): string | null {
  const end = formatDate(e.current_period_end)

  switch (e.status) {
    case 'active':
      if (e.cancel_at_period_end) return end ? `Ends ${end}` : 'Ends at the end of this period'
      return end ? `Renews ${end}` : null
    case 'trialing':
      return end ? `Trial ends ${end}` : 'Trial'
    // Retryable: a card that failed is not a cancellation, and the website
    // keeps access alive to the end of the paid period so a bad card can't
    // cut a DJ off mid-set.
    case 'past_due':
      return end ? `Payment failed — access until ${end}` : 'Payment failed'
    case 'paused':
      return 'Paused'
    case 'canceled':
      return 'Canceled'
    case 'unpaid':
      return 'Unpaid'
    case 'revoked':
      return 'Revoked'
    default:
      // incomplete / incomplete_expired — a checkout that never finished.
      return 'Not finished'
  }
}

// `null` means the row has not been read yet (or there is no session). Free
// is the honest answer for both: the desktop app is free, and every account
// starts on a free row.
export function describePlan(entitlement: Entitlement | null): PlanSummary {
  if (!entitlement || entitlement.plan === 'free') {
    return {
      name: 'Free',
      tagline: 'The full desktop app, at no cost — nothing here is locked.',
      note: null,
      includes: FREE_INCLUDES,
      paid: false
    }
  }

  return {
    name: 'Cloud Sync',
    tagline: 'Your library follows you between machines.',
    note: syncNote(entitlement),
    includes: SYNC_INCLUDES,
    paid: true
  }
}

// Short form for the places that have room for a word, not a card — the
// dashboard account chip and the empty state's signed-in line.
export function planBadge(entitlement: Entitlement | null): string {
  return describePlan(entitlement).name
}
