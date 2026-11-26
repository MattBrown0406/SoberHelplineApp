/**
 * Admin-only: the membership-invitation figures per place, worked out from
 * the membership-path events. Pure (no device or network imports), so it runs
 * in unit tests.
 */
/** The invitation moments (ContextualMembershipInvitation), in the order shown here. */
export const INVITATION_PLACEMENTS = ['practice_completed', 'boundary_saved', 'after_meeting', 'tool_finished', 'checkin_week'] as const;

/** Admin-only English names for each place an invitation can appear. */
const PLACEMENT_LABELS: Record<string, string> = {
  practice_completed: 'After free practice',
  boundary_saved: 'After saving a boundary',
  after_meeting: 'Back from Family Squares',
  tool_finished: 'After finishing a tool',
  checkin_week: 'Five-day check-in streak',
  today_locked_preview: 'Today: locked progress row',
};

export function placementLabel(source: string): string {
  return PLACEMENT_LABELS[source] ?? source.replace(/_/g, ' ');
}

export type PlacementRow = { source: string; shown: number; tapped: number; subscribed: number };
type EventRow = { account_id?: unknown; stage?: unknown; metadata?: unknown };

/**
 * Members (each counted once) who were shown an invitation in each place,
 * who tapped it, and who then subscribed with that place as where they came
 * from (purchase_succeeded carries the same source label). The five
 * invitation moments always have a row; any other place appears once it has
 * been shown or tapped. `skipAccount` (the admin looking) is left out.
 */
export function invitationPlacementRows(events: unknown, skipAccount: string | null): PlacementRow[] {
  const sets = new Map<string, { shown: Set<string>; tapped: Set<string>; subscribed: Set<string> }>();
  const at = (source: string) => {
    let entry = sets.get(source);
    if (!entry) { entry = { shown: new Set(), tapped: new Set(), subscribed: new Set() }; sets.set(source, entry); }
    return entry;
  };
  for (const place of INVITATION_PLACEMENTS) at(place);
  for (const event of Array.isArray(events) ? events as EventRow[] : []) {
    const account = typeof event?.account_id === 'string' ? event.account_id : null;
    const source = (event?.metadata as { source?: unknown } | null)?.source;
    if (!account || account === skipAccount || typeof source !== 'string') continue;
    if (event.stage === 'membership_invite_shown') at(source).shown.add(account);
    else if (event.stage === 'membership_invite_tapped') at(source).tapped.add(account);
    else if (event.stage === 'purchase_succeeded' && sets.has(source)) sets.get(source)!.subscribed.add(account);
  }
  return [...sets].map(([source, s]) => ({ source, shown: s.shown.size, tapped: s.tapped.size, subscribed: s.subscribed.size }))
    .filter((row) => (INVITATION_PLACEMENTS as readonly string[]).includes(row.source) || row.shown || row.tapped);
}
