export const FAMILY_OUTCOME_EVENTS = [
  'entered_care',
  'changed_level_of_care',
  'completed_care',
  'left_care_early',
  'returned_home',
  'returned_to_use',
  'reengaged_in_care',
  'other',
] as const;

export const FAMILY_OUTCOME_LEVELS = [
  'withdrawal_management',
  'residential',
  'partial_hospitalization',
  'intensive_outpatient',
  'outpatient',
  'recovery_residence',
  'hospital',
  'other',
  'unknown',
] as const;

export const FAMILY_OUTCOME_PATHWAYS = [
  'self_initiated',
  'family_boundary',
  'planned_intervention',
  'professional_intervention',
  'crisis_or_emergency',
  'clinician_referral',
  'court_or_legal',
  'provider_transfer',
  'peer_or_recovery_support',
  'other',
  'unknown',
] as const;

export type FamilyOutcomeEvent = (typeof FAMILY_OUTCOME_EVENTS)[number];
export type FamilyOutcomeLevel = (typeof FAMILY_OUTCOME_LEVELS)[number];
export type FamilyOutcomePathway = (typeof FAMILY_OUTCOME_PATHWAYS)[number];

export interface FamilyOutcome {
  id: string;
  clientEventId: string;
  event: FamilyOutcomeEvent;
  occurredOn: string;
  levelOfCare: FamilyOutcomeLevel;
  pathway: FamilyOutcomePathway;
  pathwayNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyOutcomeDraft {
  event: FamilyOutcomeEvent;
  occurredOn: string;
  levelOfCare: FamilyOutcomeLevel;
  pathway: FamilyOutcomePathway;
  pathwayNote: string;
}

const EVENT_SET = new Set<string>(FAMILY_OUTCOME_EVENTS);
const LEVEL_SET = new Set<string>(FAMILY_OUTCOME_LEVELS);
const PATHWAY_SET = new Set<string>(FAMILY_OUTCOME_PATHWAYS);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function localDateString(date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function defaultFamilyOutcomeDraft(
  event: FamilyOutcomeEvent = 'entered_care',
  pathway: FamilyOutcomePathway = 'unknown',
  date = new Date(),
): FamilyOutcomeDraft {
  return {
    event,
    occurredOn: localDateString(date),
    levelOfCare: 'unknown',
    pathway,
    pathwayNote: '',
  };
}

export function isFamilyOutcomeEvent(value: unknown): value is FamilyOutcomeEvent {
  return typeof value === 'string' && EVENT_SET.has(value);
}

export function isFamilyOutcomePathway(value: unknown): value is FamilyOutcomePathway {
  return typeof value === 'string' && PATHWAY_SET.has(value);
}

export function validateFamilyOutcomeDraft(
  draft: FamilyOutcomeDraft,
  today = localDateString(),
): 'event' | 'date' | 'level' | 'pathway' | 'note' | null {
  if (!EVENT_SET.has(draft.event)) return 'event';
  if (!DATE_PATTERN.test(draft.occurredOn)) return 'date';
  const parsed = new Date(`${draft.occurredOn}T00:00:00`);
  if (
    !Number.isFinite(parsed.getTime())
    || localDateString(parsed) !== draft.occurredOn
    || draft.occurredOn > today
  ) return 'date';
  if (!LEVEL_SET.has(draft.levelOfCare)) return 'level';
  if (!PATHWAY_SET.has(draft.pathway)) return 'pathway';
  if (draft.pathwayNote.trim().length > 500) return 'note';
  return null;
}

export function parseFamilyOutcome(row: Record<string, unknown> | null): FamilyOutcome | null {
  if (
    !row
    || typeof row.id !== 'string'
    || typeof row.client_event_id !== 'string'
    || !isFamilyOutcomeEvent(row.event)
    || typeof row.occurred_on !== 'string'
    || typeof row.level_of_care !== 'string'
    || !LEVEL_SET.has(row.level_of_care)
    || !isFamilyOutcomePathway(row.pathway)
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
  ) return null;

  return {
    id: row.id,
    clientEventId: row.client_event_id,
    event: row.event,
    occurredOn: row.occurred_on,
    levelOfCare: row.level_of_care as FamilyOutcomeLevel,
    pathway: row.pathway,
    pathwayNote: typeof row.pathway_note === 'string' ? row.pathway_note : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
