import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  defaultFamilyVisitationPlan,
  familyVisitationProgress,
  parseFamilyVisitationPlan,
  updateFamilyVisitationPlan,
  VISITATION_COMMITMENTS,
} from '../src/lib/familyVisitationPlan';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function completePlan() {
  let plan = defaultFamilyVisitationPlan();
  plan = updateFamilyVisitationPlan(plan, {
    facility: 'Treatment program',
    visitDate: '2026-08-20',
    arrivalTime: '2:00 PM',
    leaveTime: '3:00 PM',
    attendees: 'Jordan and Casey',
    carePackage: 'Socks, stamps, approved paperback',
    parkingLotExitPlan: 'Walk directly to the car together and leave the property.',
  });
  for (const id of VISITATION_COMMITMENTS) {
    plan = updateFamilyVisitationPlan(plan, { commitments: { ...plan.commitments, [id]: true } });
  }
  return plan;
}

test('visit is incomplete until it is written before the drive', () => {
  const progress = familyVisitationProgress(defaultFamilyVisitationPlan());
  assert.equal(progress.ready, false);
  assert.ok(progress.missing.includes('facility'));
  assert.ok(progress.missing.includes('visitDate'));
  assert.ok(progress.missing.includes('leaveTime'));
  assert.ok(progress.missing.includes('parkingLotExitPlan'));
});

test('all visitation boundaries are required', () => {
  const plan = completePlan();
  assert.equal(familyVisitationProgress(plan).ready, true);
  for (const id of VISITATION_COMMITMENTS) {
    const changed = updateFamilyVisitationPlan(plan, { commitments: { ...plan.commitments, [id]: false } });
    assert.equal(familyVisitationProgress(changed).ready, false, id);
  }
});

test('impossible dates and blank care package plans fail closed', () => {
  let plan = completePlan();
  plan = updateFamilyVisitationPlan(plan, { visitDate: '2026-02-31' });
  assert.equal(familyVisitationProgress(plan).ready, false);
  plan = updateFamilyVisitationPlan(completePlan(), { carePackage: '' });
  assert.equal(familyVisitationProgress(plan).ready, false);
});

test('stored plans normalize unknown and oversized values', () => {
  const parsed = parseFamilyVisitationPlan(JSON.stringify({
    ...completePlan(),
    facility: 'x'.repeat(500),
    commitments: { ...completePlan().commitments, leaveOnTime: false, unknownRule: true },
  }));
  assert.equal(parsed.facility.length, 350);
  assert.equal((parsed.commitments as Record<string, boolean>).unknownRule, undefined);
  assert.equal(parsed.commitments.noCash, true);
  assert.equal(parsed.commitments.leaveOnTime, false);
});

test('present but truncated protected plans fail closed', () => {
  assert.throws(() => parseFamilyVisitationPlan('{}'), /missing_field/);
  assert.throws(() => parseFamilyVisitationPlan(JSON.stringify({ ...completePlan(), commitments: {} })), /missing_commitment/);
});

test('route, localization, protected storage, and Tools entry are wired', () => {
  const route = readFileSync(resolve(TEST_DIR, '../app/family-visitation-plan.tsx'), 'utf8');
  const storage = readFileSync(resolve(TEST_DIR, '../src/storage/familyVisitationPlan.ts'), 'utf8');
  const hook = readFileSync(resolve(TEST_DIR, '../src/hooks/useFamilyVisitationPlan.ts'), 'utf8');
  const tools = readFileSync(resolve(TEST_DIR, '../app/(tabs)/learn.tsx'), 'utf8');
  const en = JSON.parse(readFileSync(resolve(TEST_DIR, '../src/locales/en/familyVisitationPlan.json'), 'utf8')) as Record<string, unknown>;
  const es = JSON.parse(readFileSync(resolve(TEST_DIR, '../src/locales/es/familyVisitationPlan.json'), 'utf8')) as Record<string, unknown>;
  const keys = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, row]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return row && typeof row === 'object' && !Array.isArray(row) ? keys(row as Record<string, unknown>, path) : [path];
  }).sort();

  assert.deepEqual(keys(en), keys(es));
  const enCommitments = (en.commitments ?? {}) as Record<string, string>;
  assert.match(enCommitments.noCash, /No cash in the card/);
  assert.match(enCommitments.noRoomReady, /your room is ready/);
  assert.match(enCommitments.noOutsideNegotiation, /relitigate going home/);
  assert.match(enCommitments.leaveOnTime, /leave at the written time/);
  assert.match(enCommitments.approvedCarePackage, /socks, stamps/);
  assert.match(String(en.coreMessage), /parking lot after visiting hours/);
  assert.match(route, /accessibilityRole="checkbox"/);
  assert.match(route, /saveState === 'saved'/);
  assert.match(storage, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(storage, /encodeURIComponent\(accountId\)/);
  assert.match(hook, /accountId/);
  assert.match(hook, /loadState: 'error'/);
  assert.match(hook, /readVersion/);
  assert.match(hook, /clearing/);
  assert.match(hook, /bound\.accountId === accountId/);
  assert.match(tools, /router\.push\('\/family-visitation-plan'/);
  assert.match(tools, /tools\.visitationTitle/);
});
