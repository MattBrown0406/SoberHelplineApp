export const SITUATIONS = ['worried', 'refuses', 'treatment', 'boundaries', 'urgent'] as const;
export type StartSituation = typeof SITUATIONS[number];
export const JOURNEY_STEPS = ['understand', 'boundary', 'practice', 'support'] as const;
export type JourneyStep = typeof JOURNEY_STEPS[number];
export interface GuidedStart { version: 1; situation: StartSituation | null; completed: JourneyStep[] }
export const emptyGuidedStart = (): GuidedStart => ({ version: 1, situation: null, completed: [] });
export const JOURNEY_ROUTES = { understand: '/(tabs)/learn', boundary: '/(tabs)/boundaries', practice: '/(tabs)/scripts', support: '/(tabs)/support' } as const;
export function situationRoute(situation: StartSituation) {
  return ({ worried: '/(tabs)/learn', refuses: '/(tabs)/scripts', treatment: '/homecoming-week', boundaries: '/(tabs)/boundaries', urgent: '/safety-wallet' } as const)[situation];
}
export function completeJourneyStep(value: GuidedStart, step: JourneyStep): GuidedStart {
  return JOURNEY_STEPS[value.completed.length] === step ? { ...value, completed: [...value.completed, step] } : value;
}
export function parseGuidedStart(raw: string | null): GuidedStart {
  if (raw === null) return emptyGuidedStart();
  const v: unknown = JSON.parse(raw);
  if (!v || typeof v !== 'object') throw Error('Invalid guided start');
  const value = v as GuidedStart;
  if (value.version !== 1 || (value.situation !== null && !SITUATIONS.includes(value.situation)) ||
      !Array.isArray(value.completed) || value.completed.length > 4 ||
      value.completed.some((step, i) => step !== JOURNEY_STEPS[i])) throw Error('Invalid guided start');
  return { version: 1, situation: value.situation, completed: [...value.completed] };
}
