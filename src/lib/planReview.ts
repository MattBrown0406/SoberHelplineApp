export const PLAN_REVIEW_CONSENT_VERSION = 'plan-review-v1';
export const PLAN_REVIEW_SECTION_KEYS = ['situation', 'risk', 'safetyPlan', 'boundaries', 'incidents', 'familyRoles'] as const;
export type PlanReviewSectionKey = typeof PLAN_REVIEW_SECTION_KEYS[number];
export type PlanReviewSource = Record<PlanReviewSectionKey, unknown>;
export type PlanReviewSnapshot = {
  schemaVersion: 1;
  sections: Partial<PlanReviewSource>;
};

function clean(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().slice(0, 5000);
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([key, item]) => [key.slice(0, 80), clean(item)]));
  }
  return null;
}

export function buildPlanReviewSnapshot(source: PlanReviewSource, selected: readonly PlanReviewSectionKey[]): PlanReviewSnapshot {
  const allowed = new Set(selected.filter((key): key is PlanReviewSectionKey => PLAN_REVIEW_SECTION_KEYS.includes(key)));
  const sections: Partial<PlanReviewSource> = {};
  for (const key of PLAN_REVIEW_SECTION_KEYS) {
    if (allowed.has(key)) sections[key] = clean(source[key]);
  }
  return { schemaVersion: 1, sections };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
