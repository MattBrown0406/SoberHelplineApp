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

export type TreatmentActionExecution = {
  admissionsPhone: string;
  driver: string;
  departureAt: string | null;
  nightWatch: string;
  phoneHolder: string;
  bagHolder: string;
  sentence: string;
  yesLoggedAt: string | null;
  recantedAt: string | null;
};

export type TreatmentActionPlan = {
  items: Record<TreatmentActionItemId, TreatmentActionItemState>;
  execution: TreatmentActionExecution;
  updatedAt: string | null;
};

export const TREATMENT_ACTION_DETAIL_LIMIT = 350;
export const TREATMENT_ACTION_EXECUTION_LIMIT = 120;
export const TREATMENT_ACTION_SENTENCE_LIMIT = 240;

export const TREATMENT_ACTION_ITEMS: TreatmentActionItemDefinition[] = [
  { id: 'placement', category: 'admission', detailsRequired: true, allowNotApplicable: false },
  { id: 'coverage', category: 'admission', detailsRequired: true, allowNotApplicable: false },
  { id: 'transport', category: 'departure', detailsRequired: true, allowNotApplicable: false },
  { id: 'bag', category: 'departure', detailsRequired: true, allowNotApplicable: false },
  { id: 'work', category: 'coverage', detailsRequired: true, allowNotApplicable: true },
  { id: 'dependents', category: 'coverage', detailsRequired: true, allowNotApplicable: true },
  { id: 'money', category: 'coverage', detailsRequired: true, allowNotApplicable: false },
  { id: 'documents', category: 'departure', detailsRequired: true, allowNotApplicable: false },
  { id: 'backup', category: 'admission', detailsRequired: true, allowNotApplicable: false },
];

export const LEAVE_TONIGHT_ITEM_IDS: TreatmentActionItemId[] = [
  'placement',
  'transport',
  'bag',
  'documents',
  'money',
  'backup',
];

function emptyItem(): TreatmentActionItemState {
  return { status: 'not_started', details: '', updatedAt: null };
}

function emptyExecution(): TreatmentActionExecution {
  return {
    admissionsPhone: '',
    driver: '',
    departureAt: null,
    nightWatch: '',
    phoneHolder: '',
    bagHolder: '',
    sentence: '',
    yesLoggedAt: null,
    recantedAt: null,
  };
}

export function defaultTreatmentActionPlan(): TreatmentActionPlan {
  return {
    items: Object.fromEntries(
      TREATMENT_ACTION_ITEMS.map((item) => [item.id, emptyItem()]),
    ) as Record<TreatmentActionItemId, TreatmentActionItemState>,
    execution: emptyExecution(),
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

export function admissionsDialNumber(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}

export function leaveTonightProgress(plan: TreatmentActionPlan, now = new Date()): {
  completed: number;
  total: number;
  percentage: number;
  structuredReady: boolean;
  ready: boolean;
} {
  const completed = LEAVE_TONIGHT_ITEM_IDS.filter((id) => {
    const definition = TREATMENT_ACTION_ITEMS.find((item) => item.id === id)!;
    return isTreatmentActionItemComplete(definition, plan.items[id]);
  }).length;
  const departure = plan.execution.departureAt ? new Date(plan.execution.departureAt) : null;
  const structuredReady = !!admissionsDialNumber(plan.execution.admissionsPhone)
    && plan.execution.driver.trim().length > 0
    && plan.execution.nightWatch.trim().length > 0
    && plan.execution.phoneHolder.trim().length > 0
    && plan.execution.bagHolder.trim().length > 0
    && !!departure
    && Number.isFinite(departure.getTime())
    && departure.getTime() > now.getTime();
  return {
    completed,
    total: LEAVE_TONIGHT_ITEM_IDS.length,
    percentage: Math.round((completed / LEAVE_TONIGHT_ITEM_IDS.length) * 100),
    structuredReady,
    ready: completed === LEAVE_TONIGHT_ITEM_IDS.length && structuredReady,
  };
}

export function treatmentYesState(plan: TreatmentActionPlan, now = new Date()): {
  mode: 'idle' | 'active' | 'recanted';
  elapsedMinutes: number;
  minutesToDeparture: number | null;
} {
  const yesAt = plan.execution.yesLoggedAt ? new Date(plan.execution.yesLoggedAt) : null;
  if (!yesAt || !Number.isFinite(yesAt.getTime())) {
    return { mode: 'idle', elapsedMinutes: 0, minutesToDeparture: null };
  }
  const recantedAt = plan.execution.recantedAt ? new Date(plan.execution.recantedAt) : null;
  const mode = recantedAt && Number.isFinite(recantedAt.getTime()) && recantedAt >= yesAt
    ? 'recanted'
    : 'active';
  const departure = plan.execution.departureAt ? new Date(plan.execution.departureAt) : null;
  return {
    mode,
    elapsedMinutes: Math.max(0, Math.floor((now.getTime() - yesAt.getTime()) / 60_000)),
    minutesToDeparture: departure && Number.isFinite(departure.getTime())
      ? Math.ceil((departure.getTime() - now.getTime()) / 60_000)
      : null,
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

export function updateTreatmentActionExecution(
  plan: TreatmentActionPlan,
  patch: Partial<TreatmentActionExecution>,
  now = new Date().toISOString(),
): TreatmentActionPlan {
  const safe: Partial<TreatmentActionExecution> = { ...patch };
  for (const key of ['admissionsPhone', 'driver', 'nightWatch', 'phoneHolder', 'bagHolder'] as const) {
    if (safe[key] !== undefined) safe[key] = safe[key]!.slice(0, TREATMENT_ACTION_EXECUTION_LIMIT);
  }
  if (safe.sentence !== undefined) safe.sentence = safe.sentence.slice(0, TREATMENT_ACTION_SENTENCE_LIMIT);
  return { ...plan, execution: { ...plan.execution, ...safe }, updatedAt: now };
}

function safeString(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function safeDate(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? value : null;
}

export function parseTreatmentActionPlan(raw: string | null): TreatmentActionPlan {
  const fallback = defaultTreatmentActionPlan();
  if (!raw) return fallback;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return fallback;
    const source = candidate as { items?: unknown; execution?: unknown; updatedAt?: unknown };
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
        details: safeString(row.details, TREATMENT_ACTION_DETAIL_LIMIT),
        updatedAt: safeDate(row.updatedAt),
      };
    }
    const row = source.execution && typeof source.execution === 'object' && !Array.isArray(source.execution)
      ? source.execution as Record<string, unknown>
      : {};
    const execution: TreatmentActionExecution = {
      admissionsPhone: safeString(row.admissionsPhone, TREATMENT_ACTION_EXECUTION_LIMIT),
      driver: safeString(row.driver, TREATMENT_ACTION_EXECUTION_LIMIT),
      departureAt: safeDate(row.departureAt),
      nightWatch: safeString(row.nightWatch, TREATMENT_ACTION_EXECUTION_LIMIT),
      phoneHolder: safeString(row.phoneHolder, TREATMENT_ACTION_EXECUTION_LIMIT),
      bagHolder: safeString(row.bagHolder, TREATMENT_ACTION_EXECUTION_LIMIT),
      sentence: safeString(row.sentence, TREATMENT_ACTION_SENTENCE_LIMIT),
      yesLoggedAt: safeDate(row.yesLoggedAt),
      recantedAt: safeDate(row.recantedAt),
    };
    return {
      items,
      execution,
      updatedAt: safeDate(source.updatedAt),
    };
  } catch {
    return fallback;
  }
}
