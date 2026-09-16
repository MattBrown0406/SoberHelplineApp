import type { SafetyPlan } from './safetyWallet';

/**
 * A family emergency card is the smallest useful subset of the Safety Wallet:
 * what a relative needs in the first minutes of a crisis. Everything else in
 * the wallet (address, substance and overdose history, suicide or weapons
 * notes, insurance, incidents) is private and never part of the card. Sections
 * are an allowlist the member ticks; nothing is preselected.
 */
export const EMERGENCY_CARD_SECTIONS = ['naloxone', 'treatmentContact', 'agreedPlan', 'contacts', 'boundaries'] as const;
export type EmergencyCardSection = typeof EMERGENCY_CARD_SECTIONS[number];

const SECTION_FIELDS: Readonly<Record<EmergencyCardSection, ReadonlyArray<keyof SafetyPlan>>> = {
  naloxone: ['naloxoneLocation', 'naloxoneExpiresOn'],
  treatmentContact: ['treatmentContact', 'preferredHospital'],
  agreedPlan: ['decisionMakers', 'safeAdult', 'childPickupPlan', 'keysAndMedicationPlan'],
  contacts: ['emergencyContacts'],
  boundaries: ['currentBoundaries'],
};

/** Wallet fields that can appear on a card. Anything else is private by construction. */
export const EMERGENCY_CARD_FIELDS: ReadonlyArray<keyof SafetyPlan> = Object.freeze(
  EMERGENCY_CARD_SECTIONS.flatMap((section) => SECTION_FIELDS[section]),
);

export type EmergencyCardLabels = {
  title: string;
  section: (section: EmergencyCardSection) => string;
  field: (field: keyof SafetyPlan) => string;
  crisisHeading: string;
  /** Localised sentences; the numbers 911 and 988 are never translated. */
  crisisLines: string[];
  note: string;
};

export type EmergencyCardLine = { field: keyof SafetyPlan; label: string; value: string };
export type EmergencyCardBlock = { section: EmergencyCardSection; heading: string; lines: EmergencyCardLine[] };

/** Sections that have at least one filled field, in card order. */
export function availableEmergencyCardSections(plan: SafetyPlan): EmergencyCardSection[] {
  return EMERGENCY_CARD_SECTIONS.filter((section) =>
    SECTION_FIELDS[section].some((field) => (plan[field] ?? '').trim().length > 0));
}

export function emergencyCardBlocks(
  plan: SafetyPlan,
  selected: readonly EmergencyCardSection[],
  labels: Pick<EmergencyCardLabels, 'section' | 'field'>,
): EmergencyCardBlock[] {
  return EMERGENCY_CARD_SECTIONS.flatMap((section) => {
    if (!selected.includes(section)) return [];
    const lines = SECTION_FIELDS[section].flatMap((field) => {
      const value = (plan[field] ?? '').trim();
      return value ? [{ field, label: labels.field(field), value }] : [];
    });
    return lines.length ? [{ section, heading: labels.section(section), lines }] : [];
  });
}

/**
 * Plain-text card for the share sheet or clipboard. Returns '' when no selected
 * section has content, so a caller never shares a card that is only a footer.
 */
export function familyEmergencyCardText(
  plan: SafetyPlan,
  selected: readonly EmergencyCardSection[],
  labels: EmergencyCardLabels,
): string {
  const blocks = emergencyCardBlocks(plan, selected, labels);
  if (!blocks.length) return '';
  const body = blocks.map((block) =>
    [block.heading.toUpperCase(), ...block.lines.map((line) => `${line.label}: ${line.value}`)].join('\n'));
  return [
    labels.title,
    ...body,
    [labels.crisisHeading.toUpperCase(), ...labels.crisisLines].join('\n'),
    labels.note,
  ].join('\n\n');
}
