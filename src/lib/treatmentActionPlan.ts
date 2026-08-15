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

export type TreatmentPlacementDetails = {
  programName: string;
  admissionsContactName: string;
  bedConfirmedFor: string;
  bedConfirmationWindow: string;
  bedConfirmedBy: string;
  bedReconfirmedAt: string | null;
};

export type TreatmentActionPlan = {
  items: Record<TreatmentActionItemId, TreatmentActionItemState>;
  execution: TreatmentActionExecution;
  placementDetails: TreatmentPlacementDetails;
  updatedAt: string | null;
};

export const TREATMENT_ACTION_DETAIL_LIMIT = 350;

export const TREATMENT_ACTION_EXECUTION_LIMIT = 120;
export const TREATMENT_ACTION_SENTENCE_LIMIT = 240;
export const TREATMENT_EXECUTION_RECORD_BYTE_LIMIT = 2048;
export const TREATMENT_EXECUTION_LEGACY_READ_BYTE_LIMIT = 6144;
export const TREATMENT_ITEM_RECORD_BYTE_LIMIT = 1800;
export const TREATMENT_META_RECORD_BYTE_LIMIT = 128;
export const TREATMENT_PLACEMENT_FIELD_BYTE_LIMIT = 150;
export const TREATMENT_PLACEMENT_RECORD_BYTE_LIMIT = 1800;

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

function emptyPlacementDetails(): TreatmentPlacementDetails {
  return {
    programName: '', admissionsContactName: '', bedConfirmedFor: '',
    bedConfirmationWindow: '', bedConfirmedBy: '', bedReconfirmedAt: null,
  };
}

export function defaultTreatmentActionPlan(): TreatmentActionPlan {
  return {
    items: Object.fromEntries(
      TREATMENT_ACTION_ITEMS.map((item) => [item.id, emptyItem()]),
    ) as Record<TreatmentActionItemId, TreatmentActionItemState>,
    execution: emptyExecution(),
    placementDetails: emptyPlacementDetails(),
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
  // Never flatten extensions or incidental digits into a different destination.
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
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
    && Number.isFinite(departure.getTime());
  return {
    completed,
    total: LEAVE_TONIGHT_ITEM_IDS.length,
    percentage: Math.round((completed / LEAVE_TONIGHT_ITEM_IDS.length) * 100),
    structuredReady,
    ready: completed === LEAVE_TONIGHT_ITEM_IDS.length
      && structuredReady
      && departure!.getTime() > now.getTime(),
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
    : { ...patch, details: normalizeItemDetails(patch.details) };
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
    if (safe[key] !== undefined) safe[key] = safe[key]!.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, TREATMENT_ACTION_EXECUTION_LIMIT);
  }
  if (safe.sentence !== undefined) safe.sentence = safe.sentence.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, TREATMENT_ACTION_SENTENCE_LIMIT);
  return { ...plan, execution: fitExecutionPatch(plan.execution, safe), updatedAt: now };
}

export function updateTreatmentPlacementDetails(
  plan: TreatmentActionPlan,
  patch: Partial<TreatmentPlacementDetails>,
  now = new Date().toISOString(),
): TreatmentActionPlan {
  const safe: Partial<TreatmentPlacementDetails> = { ...patch };
  for (const key of ['programName', 'admissionsContactName', 'bedConfirmedFor', 'bedConfirmationWindow', 'bedConfirmedBy'] as const) {
    if (safe[key] !== undefined) safe[key] = capUtf8(safe[key]!, TREATMENT_PLACEMENT_FIELD_BYTE_LIMIT);
  }
  const placementChanged = (['programName', 'admissionsContactName', 'bedConfirmedFor', 'bedConfirmationWindow', 'bedConfirmedBy'] as const)
    .some((key) => safe[key] !== undefined && safe[key] !== plan.placementDetails[key]);
  if (safe.bedReconfirmedAt !== undefined) safe.bedReconfirmedAt = safeDate(safe.bedReconfirmedAt);
  else if (placementChanged) safe.bedReconfirmedAt = null;
  return { ...plan, placementDetails: { ...plan.placementDetails, ...safe }, updatedAt: now };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function capUtf8(value: string, limit: number): string {
  let output = '';
  for (const character of value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')) {
    if (utf8Bytes(output + character) > limit) break;
    output += character;
  }
  return output;
}

function normalizeItemDetails(value: string): string {
  return value
    .replace(/\r\n?|\n|\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .slice(0, TREATMENT_ACTION_DETAIL_LIMIT);
}

function fitExecutionPatch(
  current: TreatmentActionExecution,
  patch: Partial<TreatmentActionExecution>,
): TreatmentActionExecution {
  const mutable = { ...patch };
  const editableKeys = ['admissionsPhone', 'driver', 'nightWatch', 'phoneHolder', 'bagHolder', 'sentence'] as const;
  let merged = { ...current, ...mutable };
  while (utf8Bytes(JSON.stringify(merged)) > TREATMENT_EXECUTION_RECORD_BYTE_LIMIT) {
    const key = editableKeys
      .filter((candidate) => typeof mutable[candidate] === 'string' && mutable[candidate]!.length > 0)
      .sort((a, b) => utf8Bytes(mutable[b] as string) - utf8Bytes(mutable[a] as string))[0];
    if (!key) return current;
    mutable[key] = Array.from(mutable[key] as string).slice(0, -1).join('');
    merged = { ...current, ...mutable };
  }
  return merged;
}

export function serializeProtectedTreatmentPlacement(details: TreatmentPlacementDetails): string {
  const raw = JSON.stringify(details);
  if (utf8Bytes(raw) > TREATMENT_PLACEMENT_RECORD_BYTE_LIMIT) throw new Error('protected_tap_placement_oversized');
  return raw;
}

export function parseProtectedTreatmentPlacement(raw: string | null): TreatmentPlacementDetails | null {
  if (raw === null) return null;
  if (utf8Bytes(raw) > TREATMENT_PLACEMENT_RECORD_BYTE_LIMIT) throw new Error('protected_tap_placement_oversized');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('protected_tap_placement_malformed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('protected_tap_placement_malformed');
  const row = value as Record<string, unknown>;
  const stringFields = ['programName', 'admissionsContactName', 'bedConfirmedFor', 'bedConfirmationWindow', 'bedConfirmedBy'] as const;
  if (stringFields.some((key) => typeof row[key] !== 'string'
    || utf8Bytes(row[key] as string) > TREATMENT_PLACEMENT_FIELD_BYTE_LIMIT
    || /[\u0000-\u001f\u007f-\u009f]/.test(row[key] as string))) {
    throw new Error('protected_tap_placement_malformed');
  }
  if (row.bedReconfirmedAt !== null && (typeof row.bedReconfirmedAt !== 'string' || !Number.isFinite(new Date(row.bedReconfirmedAt).getTime()))) {
    throw new Error('protected_tap_placement_malformed');
  }
  return {
    programName: row.programName as string,
    admissionsContactName: row.admissionsContactName as string,
    bedConfirmedFor: row.bedConfirmedFor as string,
    bedConfirmationWindow: row.bedConfirmationWindow as string,
    bedConfirmedBy: row.bedConfirmedBy as string,
    bedReconfirmedAt: row.bedReconfirmedAt as string | null,
  };
}

export function serializeProtectedTreatmentExecution(execution: TreatmentActionExecution): string {
  const raw = JSON.stringify(execution);
  if (utf8Bytes(raw) > TREATMENT_EXECUTION_RECORD_BYTE_LIMIT) throw new Error('protected_tap_execution_oversized');
  return raw;
}

export function parseProtectedTreatmentExecution(raw: string | null): TreatmentActionExecution | null {
  if (raw === null) return null;
  if (utf8Bytes(raw) > TREATMENT_EXECUTION_LEGACY_READ_BYTE_LIMIT) throw new Error('protected_tap_execution_oversized');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('protected_tap_execution_malformed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('protected_tap_execution_malformed');
  const row = value as Record<string, unknown>;
  const shortFields = ['admissionsPhone', 'driver', 'nightWatch', 'phoneHolder', 'bagHolder'] as const;
  if (shortFields.some((key) => typeof row[key] !== 'string'
    || (row[key] as string).length > TREATMENT_ACTION_EXECUTION_LIMIT)) {
    throw new Error('protected_tap_execution_malformed');
  }
  if (typeof row.sentence !== 'string'
    || row.sentence.length > TREATMENT_ACTION_SENTENCE_LIMIT) throw new Error('protected_tap_execution_malformed');
  for (const key of ['departureAt', 'yesLoggedAt', 'recantedAt'] as const) {
    if (row[key] !== null && (typeof row[key] !== 'string' || !Number.isFinite(new Date(row[key] as string).getTime()))) {
      throw new Error('protected_tap_execution_malformed');
    }
  }
  return {
    admissionsPhone: (row.admissionsPhone as string).replace(/[\u0000-\u001f\u007f-\u009f]/g, ''),
    driver: (row.driver as string).replace(/[\u0000-\u001f\u007f-\u009f]/g, ''),
    departureAt: row.departureAt as string | null,
    nightWatch: (row.nightWatch as string).replace(/[\u0000-\u001f\u007f-\u009f]/g, ''),
    phoneHolder: (row.phoneHolder as string).replace(/[\u0000-\u001f\u007f-\u009f]/g, ''),
    bagHolder: (row.bagHolder as string).replace(/[\u0000-\u001f\u007f-\u009f]/g, ''),
    sentence: row.sentence.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''),
    yesLoggedAt: row.yesLoggedAt as string | null,
    recantedAt: row.recantedAt as string | null,
  };
}

export function serializeProtectedTreatmentActionItem(item: TreatmentActionItemState): string {
  const raw = JSON.stringify(item);
  if (utf8Bytes(raw) > TREATMENT_ITEM_RECORD_BYTE_LIMIT) throw new Error('protected_tap_item_oversized');
  return raw;
}

export function parseProtectedTreatmentActionItem(raw: string | null): TreatmentActionItemState | null {
  if (raw === null) return null;
  if (utf8Bytes(raw) > 2048) throw new Error('protected_tap_item_oversized');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('protected_tap_item_malformed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('protected_tap_item_malformed');
  const row = value as Record<string, unknown>;
  if (!['not_started', 'working', 'confirmed', 'not_applicable'].includes(row.status as string)
    || typeof row.details !== 'string'
    || row.details.length > TREATMENT_ACTION_DETAIL_LIMIT
    || (row.updatedAt !== null && (typeof row.updatedAt !== 'string' || !Number.isFinite(new Date(row.updatedAt).getTime())))) {
    throw new Error('protected_tap_item_malformed');
  }
  return { status: row.status as TreatmentActionStatus, details: normalizeItemDetails(row.details), updatedAt: row.updatedAt as string | null };
}

export function parseProtectedTreatmentMeta(raw: string | null): string | null {
  if (raw === null) return null;
  if (utf8Bytes(raw) > TREATMENT_META_RECORD_BYTE_LIMIT) throw new Error('protected_tap_meta_oversized');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('protected_tap_meta_malformed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('protected_tap_meta_malformed');
  const updatedAt = (value as Record<string, unknown>).updatedAt;
  if (updatedAt !== null && (typeof updatedAt !== 'string' || !Number.isFinite(new Date(updatedAt).getTime()))) {
    throw new Error('protected_tap_meta_malformed');
  }
  return updatedAt as string | null;
}

export function serializeProtectedTreatmentMeta(updatedAt: string | null): string {
  if (updatedAt !== null && !Number.isFinite(new Date(updatedAt).getTime())) {
    throw new Error('protected_tap_meta_malformed');
  }
  const raw = JSON.stringify({ updatedAt });
  if (utf8Bytes(raw) > TREATMENT_META_RECORD_BYTE_LIMIT) throw new Error('protected_tap_meta_oversized');
  return raw;
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
    const source = candidate as { items?: unknown; execution?: unknown; placementDetails?: unknown; updatedAt?: unknown };
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
    const placementRow = source.placementDetails && typeof source.placementDetails === 'object' && !Array.isArray(source.placementDetails)
      ? source.placementDetails as Record<string, unknown>
      : {};
    const placementDetails: TreatmentPlacementDetails = {
      programName: safeString(placementRow.programName, TREATMENT_ACTION_DETAIL_LIMIT),
      admissionsContactName: safeString(placementRow.admissionsContactName, TREATMENT_ACTION_DETAIL_LIMIT),

      bedConfirmedFor: safeString(placementRow.bedConfirmedFor, TREATMENT_ACTION_DETAIL_LIMIT),
      bedConfirmationWindow: safeString(placementRow.bedConfirmationWindow, TREATMENT_ACTION_DETAIL_LIMIT),
      bedConfirmedBy: safeString(placementRow.bedConfirmedBy, TREATMENT_ACTION_DETAIL_LIMIT),
      bedReconfirmedAt: safeDate(placementRow.bedReconfirmedAt),
    };
    return {
      items,
      execution,
      placementDetails,
      updatedAt: safeDate(source.updatedAt),
    };
  } catch {
    return fallback;
  }
}
