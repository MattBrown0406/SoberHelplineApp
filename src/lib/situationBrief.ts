import type { Situation, SituationBand } from './situation';

/**
 * Situation Brief — the member-facing model for "Send Matt this week".
 * All section data is assembled server-side (see 20260730160000_situation_briefs.sql);
 * the client renders the preview verbatim and supplies only the optional note.
 */

export interface BriefMoodDay {
  day: string;
  mood: number;
  note: string | null;
}

export interface BriefTrackerSign {
  sign_key: string;
  kind: 'warning' | 'recovery';
  week: string;
}

export interface BriefWall {
  text: string;
  anchor: string | null;
  created_at: string;
}

export interface BriefLovedOne {
  relationship: string | null;
  first_name: string | null;
  substances: string[];
  stage: string | null;
  status: string;
}

export interface BriefRehearsal {
  created_at: string;
  scores: Record<string, number> | null;
}

export interface BriefSections {
  mood: BriefMoodDay[];
  tracker: BriefTrackerSign[];
  boundaries: BriefWall[];
  loved_one: BriefLovedOne | null;
  rehearsal: BriefRehearsal[];
  generated_at: string;
  /** Present on stored briefs (merged in at send time), absent on previews. */
  situation?: Situation;
}

export interface BriefPreview {
  situation: Situation;
  sections: BriefSections;
  can_send: boolean;
  next_allowed_at: string | null;
}

export type BriefStatus = 'sent' | 'read' | 'replied';

export interface SituationBriefRow {
  id: string;
  band: SituationBand;
  score: number;
  sustained: boolean;
  note: string | null;
  status: BriefStatus;
  created_at: string;
  read_at: string | null;
  replied_at: string | null;
}

/** Admin inbox row (admin_get_situation_briefs). */
export interface AdminBriefRow {
  id: string;
  account_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  band: SituationBand;
  score: number;
  sustained: boolean;
  note: string | null;
  status: BriefStatus;
  created_at: string;
}

/** Admin detail payload (admin_get_situation_brief). */
export interface AdminBriefDetail extends AdminBriefRow {
  sections: BriefSections;
}

type TrackerSignDef = { id: string; label: string; category: string };

/**
 * Map tracker sign keys to their human labels using the tracker namespace
 * content (returnObjects on tracker:warning.signs / tracker:recovery.signs).
 * Falls back to a humanized key so an unknown/renamed sign never renders blank.
 */
export function signLabel(
  signKey: string,
  warningSigns: TrackerSignDef[],
  recoverySigns: TrackerSignDef[],
): string {
  const match =
    warningSigns.find((s) => s.id === signKey) ??
    recoverySigns.find((s) => s.id === signKey);
  if (match) return match.label;
  return signKey.replace(/^[wr]-/, '').replace(/[-_]/g, ' ');
}

export function briefMoodAverage(mood: BriefMoodDay[]): number | null {
  if (mood.length === 0) return null;
  return Math.round((mood.reduce((sum, m) => sum + m.mood, 0) / mood.length) * 10) / 10;
}
