import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SAFETY_PLAN, type SafetyPlan } from '../src/lib/safetyWallet';
import {
  EMERGENCY_CARD_FIELDS,
  EMERGENCY_CARD_SECTIONS,
  availableEmergencyCardSections,
  emergencyCardBlocks,
  familyEmergencyCardText,
  type EmergencyCardLabels,
  type EmergencyCardSection,
} from '../src/lib/familyEmergencyCard';

type Crisis = {
  wallet: {
    fields: Record<keyof SafetyPlan, string>;
    familyCard: {
      title: string;
      sections: Record<EmergencyCardSection, string>;
      crisisHeading: string;
      crisisLines: string[];
      note: string;
    };
  };
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadCrisis = (lang: 'en' | 'es'): Crisis =>
  JSON.parse(readFileSync(resolve(ROOT, `src/locales/${lang}/crisis.json`), 'utf8')) as Crisis;
const enCrisis = loadCrisis('en');
const esCrisis = loadCrisis('es');

function labels(locale: Crisis): EmergencyCardLabels {
  const card = locale.wallet.familyCard;
  return {
    title: card.title,
    section: (section) => card.sections[section],
    field: (field) => locale.wallet.fields[field],
    crisisHeading: card.crisisHeading,
    crisisLines: card.crisisLines,
    note: card.note,
  };
}

const PRIVATE_VALUES = {
  lovedOneName: 'PRIVATE_NAME',
  householdAddress: 'PRIVATE_ADDRESS',
  substances: 'PRIVATE_SUBSTANCES',
  overdoseHistory: 'PRIVATE_OVERDOSE',
  suicideHistory: 'PRIVATE_SUICIDE',
  weaponsAccess: 'PRIVATE_WEAPONS',
  childrenInHome: 'PRIVATE_CHILDREN',
  insurance: 'PRIVATE_INSURANCE',
} satisfies Partial<SafetyPlan>;

const plan: SafetyPlan = {
  ...DEFAULT_SAFETY_PLAN,
  ...PRIVATE_VALUES,
  naloxoneLocation: 'Kitchen drawer by the fridge',
  naloxoneExpiresOn: '2027-03',
  treatmentContact: 'Bridge Recovery admissions 541-555-0101',
  preferredHospital: 'St. Charles ER',
  emergencyContacts: 'Aunt Rosa 541-555-0199',
  decisionMakers: 'Mom coordinates, Uncle Ben is backup',
  safeAdult: 'Grandma Lee',
  childPickupPlan: 'Rosa picks up from school',
  keysAndMedicationPlan: 'Car keys and meds in the lockbox',
  currentBoundaries: 'We will not give cash. We will drive to treatment.',
};

test('the card can only ever contain the allowlisted wallet fields', () => {
  const privateFields = Object.keys(PRIVATE_VALUES);
  for (const field of privateFields) assert.ok(!EMERGENCY_CARD_FIELDS.includes(field as keyof SafetyPlan), field);
  const everything = familyEmergencyCardText(plan, EMERGENCY_CARD_SECTIONS, labels(enCrisis));
  for (const value of Object.values(PRIVATE_VALUES)) assert.ok(!everything.includes(value), value);
  assert.ok(everything.includes('Kitchen drawer by the fridge'));
  assert.ok(everything.includes('Bridge Recovery admissions 541-555-0101'));
});

test('only sections the member selected appear; nothing is preselected', () => {
  assert.deepEqual(availableEmergencyCardSections(plan), ['naloxone', 'treatmentContact', 'agreedPlan', 'contacts', 'boundaries']);
  const text = familyEmergencyCardText(plan, ['naloxone'], labels(enCrisis));
  assert.ok(text.includes('Kitchen drawer by the fridge'));
  assert.ok(!text.includes('Aunt Rosa'));
  assert.ok(!text.includes('St. Charles ER'));
  assert.equal(familyEmergencyCardText(plan, [], labels(enCrisis)), '');
});

test('empty sections and empty fields are omitted; an empty plan produces no card', () => {
  const sparse: SafetyPlan = { ...DEFAULT_SAFETY_PLAN, emergencyContacts: '  Aunt Rosa 541-555-0199  ' };
  assert.deepEqual(availableEmergencyCardSections(sparse), ['contacts']);
  const blocks = emergencyCardBlocks(sparse, EMERGENCY_CARD_SECTIONS, labels(enCrisis));
  assert.deepEqual(blocks.map((block) => block.section), ['contacts']);
  assert.deepEqual(blocks[0].lines.map((line) => line.value), ['Aunt Rosa 541-555-0199']);
  const text = familyEmergencyCardText(sparse, EMERGENCY_CARD_SECTIONS, labels(enCrisis));
  assert.ok(!text.includes(enCrisis.wallet.familyCard.sections.naloxone.toUpperCase()));
  assert.ok(!text.includes(enCrisis.wallet.fields.naloxoneExpiresOn));
  assert.equal(familyEmergencyCardText(DEFAULT_SAFETY_PLAN, EMERGENCY_CARD_SECTIONS, labels(enCrisis)), '');
});

test('the card always ends with the crisis numbers and the not-emergency-care note', () => {
  const text = familyEmergencyCardText(plan, ['contacts'], labels(enCrisis));
  const lines = text.split('\n');
  assert.equal(lines[0], enCrisis.wallet.familyCard.title);
  assert.ok(text.includes('911'));
  assert.ok(text.includes('988'));
  assert.equal(lines[lines.length - 1], enCrisis.wallet.familyCard.note);
});

test('renders fully in Spanish with no English labels and untranslated 911/988', () => {
  const es = familyEmergencyCardText(plan, EMERGENCY_CARD_SECTIONS, labels(esCrisis));
  const en = familyEmergencyCardText(plan, EMERGENCY_CARD_SECTIONS, labels(enCrisis));
  assert.ok(es.startsWith(esCrisis.wallet.familyCard.title));
  for (const section of EMERGENCY_CARD_SECTIONS) {
    assert.ok(es.includes(esCrisis.wallet.familyCard.sections[section].toUpperCase()), section);
    assert.ok(!es.includes(enCrisis.wallet.familyCard.sections[section].toUpperCase()), `en label leaked: ${section}`);
  }
  for (const field of EMERGENCY_CARD_FIELDS) {
    assert.ok(es.includes(`${esCrisis.wallet.fields[field]}: `), field);
    assert.notEqual(esCrisis.wallet.fields[field], enCrisis.wallet.fields[field], `untranslated field label: ${field}`);
  }
  assert.ok(es.includes('911') && es.includes('988'));
  assert.notEqual(es, en);
});

test('the wallet screen offers the family card to every signed-in member, ungated', () => {
  const source = readFileSync('app/safety-wallet.tsx', 'utf8');
  assert.match(source, /<FamilyEmergencyCard scope=\{user\.id\} plan=\{plan\} \/>/);
  assert.doesNotMatch(source, /useFeatureAccess|canAccessFeature|entitlements\./);
  const component = readFileSync('src/components/safety/FamilyEmergencyCard.tsx', 'utf8');
  assert.match(component, /Share\.share\(/);
  assert.match(component, /Clipboard\.setStringAsync\(/);
});
