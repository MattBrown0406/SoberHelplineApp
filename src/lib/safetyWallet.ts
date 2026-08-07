export type SafetyIncident = {
  id: string;
  createdAt: string;
  summary: string;
  substances: string;
  threats: string;
  childrenPresent: boolean;
  policeOrEms: boolean;
  boundaryCrossed: boolean;
};

export type SafetyPlan = {
  lovedOneName: string;
  householdAddress: string;
  substances: string;
  overdoseHistory: string;
  naloxoneLocation: string;
  naloxoneExpiresOn: string;
  suicideHistory: string;
  weaponsAccess: string;
  childrenInHome: string;
  safeAdult: string;
  childPickupPlan: string;
  keysAndMedicationPlan: string;
  emergencyContacts: string;
  preferredHospital: string;
  insurance: string;
  currentBoundaries: string;
  decisionMakers: string;
};

export type SafetyBoundary = {
  behavior: string;
  support: string;
  noLongerDo: string;
  consequence: string;
};

export type FamilyCommandPlan = {
  coordinator: string;
  communicator: string;
  safetyLead: string;
  unifiedStatement: string;
};

export const DEFAULT_SAFETY_PLAN: SafetyPlan = {
  lovedOneName: '',
  householdAddress: '',
  substances: '',
  overdoseHistory: '',
  naloxoneLocation: '',
  naloxoneExpiresOn: '',
  suicideHistory: '',
  weaponsAccess: '',
  childrenInHome: '',
  safeAdult: '',
  childPickupPlan: '',
  keysAndMedicationPlan: '',
  emergencyContacts: '',
  preferredHospital: '',
  insurance: '',
  currentBoundaries: '',
  decisionMakers: '',
};

export const DEFAULT_SAFETY_BOUNDARY: SafetyBoundary = {
  behavior: '',
  support: '',
  noLongerDo: '',
  consequence: '',
};

export const DEFAULT_FAMILY_COMMAND: FamilyCommandPlan = {
  coordinator: '',
  communicator: '',
  safetyLead: '',
  unifiedStatement: '',
};

export const SAFETY_STORAGE_SUFFIXES = ['plan', 'incidents', 'boundary', 'command'] as const;

export function safetyStorageKey(accountId: string, suffix: typeof SAFETY_STORAGE_SUFFIXES[number]): string {
  return `soberhelpline:crisis:${accountId}:${suffix}`;
}

/**
 * Merge a stored object onto a known-safe shape. This keeps old device records
 * compatible when new safety fields are added and ignores unexpected values.
 */
export function parseStoredRecord<T extends object>(raw: string | null, fallback: T): T {
  if (!raw) return { ...fallback };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
    const safe = { ...fallback } as Record<string, unknown>;
    const candidate = value as Record<string, unknown>;
    for (const [key, defaultValue] of Object.entries(fallback)) {
      if (typeof candidate[key] === typeof defaultValue) safe[key] = candidate[key];
    }
    return safe as T;
  } catch {
    return { ...fallback };
  }
}

export function parseStoredIncidents(raw: string | null): SafetyIncident[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      .filter((item) =>
        typeof item.id === 'string'
        && typeof item.createdAt === 'string'
        && typeof item.summary === 'string'
        && typeof item.substances === 'string'
        && typeof item.threats === 'string'
        && typeof item.childrenPresent === 'boolean'
        && typeof item.policeOrEms === 'boolean'
        && typeof item.boundaryCrossed === 'boolean')
      .slice(0, 25) as SafetyIncident[];
  } catch {
    return [];
  }
}
