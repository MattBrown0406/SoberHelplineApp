// Member-facing video/plan-review errors are shown only through each card's
// own localized `errors.*` keys. Anything unrecognized — including network
// failures, whose PostgREST error code is '' — becomes 'unknown'; a raw
// server or network message is never shown to members.

export const VIDEO_ERROR_CODES = [
  'version_conflict', 'active_session_exists', 'invalid_request', 'invalid_plan_review_request',
  'invalid_plan_review_revision', 'plan_update_not_requested', 'invalid_timezone', 'proposal_not_found',
  'session_not_found', 'premium_video_access_required', 'premier_upgrade_or_payment_required',
  'essential_or_premier_required', 'payment_not_verified', 'invalid_transition', 'start_time_in_past',
] as const;

export function videoErrorCode(error: { message?: string | null; code?: string | null } | null | undefined): string | null {
  if (!error) return null;
  const message = typeof error.message === 'string' ? error.message : '';
  return VIDEO_ERROR_CODES.find((code) => message.includes(code)) ?? 'unknown';
}

/**
 * The card's translation for an error key, falling back to that card's own
 * errors.unknown when the key belongs to the other card (both share one
 * controller in Crisis Mode) or is missing.
 */
export function videoErrorText(
  translate: (key: string, options?: Record<string, unknown>) => string,
  errorKey: string | null | undefined,
): string {
  const fallback = translate('errors.unknown');
  if (!errorKey || !/^[a-z_]+$/.test(errorKey)) return fallback;
  return translate(`errors.${errorKey}`, { defaultValue: fallback });
}
