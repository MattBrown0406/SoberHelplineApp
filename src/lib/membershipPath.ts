import type { Href } from 'expo-router';

/**
 * The membership path: who sees the plans, opens a plan, and starts or
 * finishes a purchase. Each event carries only a tier and a short label for
 * where she came from; the server keeps nothing else and stores any label
 * outside its own list as 'unknown' (migration
 * 20261114130000_membership_path_funnel mirrors both lists).
 *
 * Pure (no device or network imports), so it runs in unit tests.
 */
export const MEMBERSHIP_PATH_STAGES = [
  // The plans screen was shown (once per visit).
  'plans_viewed',
  // A plan's purchase sheet was opened.
  'plan_sheet_opened',
  // The App Store purchase was started, and how it ended.
  'purchase_started',
  'purchase_succeeded',
  'purchase_cancelled',
  'purchase_failed',
  // An invitation to look at membership was on screen; she tapped it.
  'membership_invite_shown',
  'membership_invite_tapped',
] as const;
export type MembershipPathStage = (typeof MEMBERSHIP_PATH_STAGES)[number];

/** Screen and card names only. Never anything she wrote, and never personal data. */
export const PLAN_SOURCES = [
  'after_meeting',
  'boundary_saved',
  'chat_gate',
  'crisis_command_plan',
  'crisis_plan_review',
  'diy_planner',
  'feature_gate',
  'invitation_engine',
  'invitation_setup',
  'learn_library',
  'membership_guide',
  'practice_completed',
  'rehearsal_gate',
  'support_groups',
  'support_tab',
  'support_upgrade',
  'today_locked_preview',
  'today_membership',
  'tracker_share',
] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

/** The code keys for the two paid plans ('premium' is shown as "Premier"). */
export type PlanTier = 'essential' | 'premium';

/** A route param or stored value as a known label; anything else is 'unknown'. */
export function planSource(raw: unknown): PlanSource | 'unknown' {
  return typeof raw === 'string' && (PLAN_SOURCES as readonly string[]).includes(raw) ? (raw as PlanSource) : 'unknown';
}

export function planTier(raw: unknown): PlanTier | null {
  return raw === 'essential' || raw === 'premium' ? raw : null;
}

/** Exactly what is sent with a membership-path event: a source, and a tier when there is one. */
export function membershipPathMetadata(input: { source?: unknown; tier?: unknown }): { source: PlanSource | 'unknown'; tier?: PlanTier } {
  const tier = planTier(input.tier);
  return tier ? { source: planSource(input.source), tier } : { source: planSource(input.source) };
}

/**
 * Where every "See plans" or "Upgrade" button goes: the plans screen, told
 * where she came from and, when the button named a plan, which sheet to open.
 */
export function plansHref(source: PlanSource, tier?: PlanTier): Href {
  return { pathname: '/plans', params: tier ? { source, tier } : { source } } as unknown as Href;
}

/**
 * The plan a sheet may be opened for, given what she has now. A free member
 * can open either; an Essential member can only move up to Premier; a Premier
 * or provider-covered member has nothing to buy.
 */
export function purchasableTiers(accountState: string | null | undefined): PlanTier[] {
  if (accountState === 'direct-free') return ['essential', 'premium'];
  if (accountState === 'direct-essential') return ['premium'];
  return [];
}
