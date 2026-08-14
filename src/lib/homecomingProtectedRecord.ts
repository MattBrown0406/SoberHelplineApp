export function parseProtectedHomecomingRecord(
  raw: string | null,
  label: string,
  expectedKeys: string | readonly string[],
): Record<string, unknown> {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`protected_homecoming_invalid_json:${label}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`protected_homecoming_invalid_shape:${label}`);
  }
  const record = value as Record<string, unknown>;
  const keys = typeof expectedKeys === 'string' ? [expectedKeys] : expectedKeys;
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(record, key));
  if (missing) {
    throw new Error(`protected_homecoming_missing_field:${label}:${missing}`);
  }
  return record;
}

const LEGACY_HOUSING_KEYS = [
  'housingType', 'housingDetails', 'receivingAdult',
  'adultReturnHomeConfirmed', 'adultReturnHomeQuote',
] as const;

export function parseProtectedHomecomingHousingRecord(raw: string | null): Record<string, unknown> {
  const record = parseProtectedHomecomingRecord(raw, 'discharge:housing', LEGACY_HOUSING_KEYS);
  if (raw === null) return record;
  return {
    ...record,
    otherHousingFamilyStatus: Object.prototype.hasOwnProperty.call(record, 'otherHousingFamilyStatus')
      ? record.otherHousingFamilyStatus : '',
    adultReturnHomeQuoteAffirmed: Object.prototype.hasOwnProperty.call(record, 'adultReturnHomeQuoteAffirmed')
      ? record.adultReturnHomeQuoteAffirmed : false,
  };
}
