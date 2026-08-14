export type TreatmentActionStatus = 'not_started' | 'working' | 'confirmed' | 'not_applicable';

export type TreatmentActionItemId =
  | 'placement'
  | 'coverage'
  | 'transport'
  | 'bag'
  | 'work'
  | 'dependents'
  | 'money'
  | 'documents'
  | 'backup';

export type TreatmentActionItemDefinition = {
  id: TreatmentActionItemId;
  category: 'admission' | 'departure' | 'coverage';
  detailsRequired: boolean;
  allowNotApplicable: boolean;
};

export type TreatmentActionItemState = {
  status: TreatmentActionStatus;
  details: string;
  updatedAt: string | null;
};

export type TreatmentActionPlan = {
  items: Record<TreatmentActionItemId, TreatmentActionItemState>;
  updatedAt: string | null;
};

export const TREATMENT_ACTION_DETAIL_LIMIT = 350;

export const TREATMENT_ACTION_ITEMS: TreatmentActionItemDefinition[] = [
  { id: 'placement', category: 'admission', detailsRequired: true, allowNotApplicable: false },
  { id: 'coverage', category: 'admission', detailsRequired: true, allowNotApplicable: false },
  { id: 'transport', category: 'departure', detailsRequired: true, allowNotApplicable: false },
  { id: 'bag', category: 'departure', detailsRequired: false, allowNotApplicable: false },
  { id: 'work', category: 'coverage', detailsRequired: true, allowNotApplicable: true },
  { id: 'dependents', category: 'coverage', detailsRequired: true, allowNotApplicable: true },
  { id: 'money', category: 'coverage', detailsRequired: true, allowNotApplicable: false },
  { id: 'documents', category: 'departure', detailsRequired: true, allowNotApplicable: false },
  { id: 'backup', category: 'admission', detailsRequired: true, allowNotApplicable: false },
];

function emptyItem(): TreatmentActionItemState {
  return { status: 'not_started', details: '', updatedAt: null };
}

export function defaultTreatmentActionPlan(): TreatmentActionPlan {
  return {
    items: Object.fromEntries(
      TREATMENT_ACTION_ITEMS.map((item) => [item.id, emptyItem()]),
    ) as Record<TreatmentActionItemId, TreatmentActionItemState>,
    updatedAt: null,
  };
}


export function isTreatmentActionItemComplete(
  definition: TreatmentActionItemDefinition,
  item: TreatmentActionItemState,
): boolean {
  const hasDetails = item.details.trim().length > 0;
  if (item.status === 'confirmed') return !definition.detailsRequired || hasDetails;
  return item.status === 'not_applicable' && definition.allowNotApplicable && hasDetails;
}

export function treatmentActionProgress(plan: TreatmentActionPlan): {
  completed: number;
  total: number;
  percentage: number;
  ready: boolean;
} {
  const completed = TREATMENT_ACTION_ITEMS.filter((definition) =>
    isTreatmentActionItemComplete(definition, plan.items[definition.id]),
  ).length;
  const total = TREATMENT_ACTION_ITEMS.length;
  return {
    completed,
    total,
    percentage: Math.round((completed / total) * 100),
    ready: completed === total,
  };
}

export function updateTreatmentActionItem(
  plan: TreatmentActionPlan,
  id: TreatmentActionItemId,
  patch: Partial<Pick<TreatmentActionItemState, 'status' | 'details'>>,
  now = new Date().toISOString(),
): TreatmentActionPlan {
  const safePatch = patch.details === undefined
    ? patch
    : { ...patch, details: patch.details.slice(0, TREATMENT_ACTION_DETAIL_LIMIT) };
  return {
    ...plan,
    updatedAt: now,
    items: {
      ...plan.items,
      [id]: { ...plan.items[id], ...safePatch, updatedAt: now },
    },
  };
}

export function parseTreatmentActionPlan(raw: string | null): TreatmentActionPlan {
  const fallback = defaultTreatmentActionPlan();
  if (!raw) return fallback;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return fallback;
    const source = candidate as { items?: unknown; updatedAt?: unknown };
    const sourceItems = source.items && typeof source.items === 'object' && !Array.isArray(source.items)
      ? source.items as Record<string, unknown>
      : {};
    const items = { ...fallback.items };
    for (const definition of TREATMENT_ACTION_ITEMS) {
      const value = sourceItems[definition.id];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      const status = row.status;
      const validStatus: TreatmentActionStatus =
        status === 'working' || status === 'confirmed' || status === 'not_applicable'
          ? status
          : 'not_started';
      items[definition.id] = {
        status: validStatus,
        details: typeof row.details === 'string'
          ? row.details.slice(0, TREATMENT_ACTION_DETAIL_LIMIT)
          : '',
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
      };
    }
    return {
      items,
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    };
  } catch {
    return fallback;
  }
}
