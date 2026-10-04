import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { crisisSessionView } from '../src/lib/crisisSessionView';
import {
  ACCOUNT_READ_RETRY_DELAYS_MS,
  accountReadRetryDelay,
  directStateAfterEntitlementRead,
  lastKnownDirectState,
} from '../src/lib/authBootstrap';
import { readCachedAccountState, cacheSuccessfulAccount, restoreOfflineAccount } from '../src/lib/offlineAccountCache';
import { entitlementsForAccountState } from '../src/lib/featureAccess';
import {
  FAMILY_SPACE_REFRESH_THROTTLE_MS,
  requestFamilySpaceRefresh,
  shouldRefreshFamilySpace,
  subscribeFamilySpaceRefresh,
} from '../src/lib/familySpaceRefresh';
import { INITIAL_TRACKER_SPIKE_MEMORY, nextTrackerSpike, type TrackerSpikeMemory } from '../src/lib/trackerSpike';
import { pathwayPhaseUpdate, RECOVERY_PHASES } from '../src/lib/recoveryPathway';
import { chooseFreeCall, isCallInProgress } from '../src/lib/familySquaresSchedule';
import { getSupportGroups } from '../src/content/supportGroups';
import type { AuthUser } from '../src/api/types';

const read = (path: string) => readFileSync(path, 'utf8');

// ── 1. A lapsed member keeps her own plan-review session ────────────────────
const NO_ACCESS = { hasEssential: false, canAccessPrivateVideo: false, entitlementsSettled: true, sessionsLoaded: true, sessionLoadFailed: false };
const ONE_OFF = { appointment_type: 'one_off_150', booking_purpose: 'plan_review' };

test('a lapsed member with an active plan review sees, pays for and joins it; the gate only shows without one', () => {
  const lapsed = crisisSessionView({ ...NO_ACCESS, activeSession: ONE_OFF });
  assert.deepEqual(lapsed, { showSessionCard: true, showPlanReviewCard: true, showGate: false, showLoadError: false });

  // An included session booked while she had Premier is still hers.
  const included = crisisSessionView({ ...NO_ACCESS, activeSession: { appointment_type: 'membership_included', booking_purpose: 'general_support' } });
  assert.equal(included.showSessionCard, true);
  assert.equal(included.showPlanReviewCard, false);
  assert.equal(included.showGate, false);

  assert.deepEqual(crisisSessionView({ ...NO_ACCESS, activeSession: null }), { showSessionCard: false, showPlanReviewCard: false, showGate: true, showLoadError: false });
  // Never flash the gate before entitlements and her sessions are known.
  assert.equal(crisisSessionView({ ...NO_ACCESS, sessionsLoaded: false, activeSession: null }).showGate, false);
  assert.equal(crisisSessionView({ ...NO_ACCESS, entitlementsSettled: false, activeSession: null }).showGate, false);
  // A failed read offers a retry, not the gate.
  assert.deepEqual(crisisSessionView({ ...NO_ACCESS, sessionLoadFailed: true, activeSession: null }), { showSessionCard: false, showPlanReviewCard: false, showGate: false, showLoadError: true });

  // Members keep their existing cards.
  assert.deepEqual(crisisSessionView({ ...NO_ACCESS, hasEssential: true, activeSession: null }), { showSessionCard: false, showPlanReviewCard: true, showGate: false, showLoadError: false });
  assert.deepEqual(crisisSessionView({ ...NO_ACCESS, hasEssential: true, canAccessPrivateVideo: true, activeSession: null }), { showSessionCard: true, showPlanReviewCard: true, showGate: false, showLoadError: false });
});

test('Crisis Mode loads her own sessions whatever her tier', () => {
  const screen = read('app/crisis-mode.tsx');
  assert.match(screen, /usePrivateVideoSessions\(\s*isOfflineAccountFallback \? null : user\?\.id \?\? null,\s*!isOfflineAccountFallback && !!user,\s*\)/);
  assert.doesNotMatch(screen, /appointment_type === 'one_off_150'\) \?/);
  assert.match(screen, /sessionView\.showGate/);
  assert.match(screen, /sessionView\.showSessionCard \? <PremierVideoSchedulingCard/);
  const hook = read('src/hooks/usePrivateVideoSessions.ts');
  assert.match(hook, /loaded: stateScope\.current === scope && loaded/);
});

// ── 2. A failed entitlement read never downgrades ──────────────────────────
test('a failed or slow entitlement read keeps the last known tier and is never verified', () => {
  const now = new Date('2026-10-03T00:00:00Z');
  assert.deepEqual(
    directStateAfterEntitlementRead({ rows: [{ tier: 'essential', expires_at: null }], lastKnownState: 'direct-premium', now }),
    { state: 'direct-essential', verified: true },
    'a successful read is authoritative, even when lower',
  );
  assert.deepEqual(directStateAfterEntitlementRead({ rows: [], lastKnownState: 'direct-premium', now }), { state: 'direct-free', verified: true });
  assert.deepEqual(directStateAfterEntitlementRead({ rows: null, lastKnownState: 'direct-premium', now }), { state: 'direct-premium', verified: false });
  assert.deepEqual(directStateAfterEntitlementRead({ rows: null, lastKnownState: null, now }), { state: 'direct-free', verified: false });
  assert.deepEqual(directStateAfterEntitlementRead({ rows: null, lastKnownState: 'attached', now }), { state: 'direct-free', verified: false });

  assert.equal(lastKnownDirectState('acc-1', [{ id: 'acc-1', accountState: 'direct-essential' }, { id: 'acc-1', accountState: 'direct-premium' }]), 'direct-essential');
  assert.equal(lastKnownDirectState('acc-1', [null, { id: 'acc-1', accountState: 'direct-premium' }]), 'direct-premium');
  assert.equal(lastKnownDirectState('acc-1', [{ id: 'acc-2', accountState: 'direct-premium' }]), null, 'never another account');
  assert.equal(lastKnownDirectState('acc-1', [{ id: 'acc-1', accountState: 'attached' }]), null);

  assert.deepEqual(ACCOUNT_READ_RETRY_DELAYS_MS.map((_, i) => accountReadRetryDelay(i)), [5_000, 15_000, 30_000, 60_000]);
  assert.equal(accountReadRetryDelay(ACCOUNT_READ_RETRY_DELAYS_MS.length), null);
  assert.equal(accountReadRetryDelay(-1), null);
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); },
    removeItem: async (key: string) => { data.delete(key); },
  };
}

const ACCOUNT: AuthUser = {
  id: 'acc-1', firstName: 'Ana', lastName: '', email: 'a@example.com', avatarUrl: null,
  accountState: 'direct-premium', entitlements: entitlementsForAccountState('direct-premium'),
  orgId: null, branding: null, joinedAt: '2026-01-01T00:00:00Z', timezone: 'America/Los_Angeles',
};

test('the cached tier is read only for the same principal and account; the offline restore still fails closed', async () => {
  const storage = memoryStorage();
  await cacheSuccessfulAccount('principal-1', ACCOUNT, storage);
  assert.equal(await readCachedAccountState('principal-1', 'acc-1', storage), 'direct-premium');
  assert.equal(await readCachedAccountState('principal-1', 'acc-2', storage), null);
  assert.equal(await readCachedAccountState('principal-2', 'acc-1', storage), null);
  assert.equal((await restoreOfflineAccount('principal-1', storage))?.accountState, 'direct-free');
  storage.data.set([...storage.data.keys()][0], '{not json');
  assert.equal(await readCachedAccountState('principal-1', 'acc-1', storage), null);
});

test('AccountContext caches only verified tiers and retries a failed read on foreground with backoff', () => {
  const context = read('src/contexts/AccountContext.tsx');
  assert.match(context, /if \(load\.verified\) queueAccountCacheWrite/);
  assert.doesNotMatch(context, /queueAccountCacheWrite\((sessionUser|currentAuthUser)\.id, (account|enriched)\)/);
  assert.match(context, /directStateAfterEntitlementRead\(/);
  assert.match(context, /accountReadRetryDelay\(attempt\)/);
  assert.match(context, /if \(!accountReadFailed \|\| isOfflineAccountFallback\) return;/);
  assert.match(context, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active'\) retry\(\);/);
  assert.match(context, /refreshAccount\(\{ keepCurrentOnFailure: true \}\)/);
});

// ── 3. The family space refreshes ──────────────────────────────────────────
test('family-space change notices reach every other mounted copy, and focus refreshes are throttled', () => {
  const seen: Array<[string, string | null]> = [];
  const offA = subscribeFamilySpaceRefresh((source) => seen.push(['A', source]));
  const offB = subscribeFamilySpaceRefresh((source) => { seen.push(['B', source]); throw new Error('one reader failing'); });
  const offC = subscribeFamilySpaceRefresh((source) => seen.push(['C', source]));
  requestFamilySpaceRefresh('today');
  assert.deepEqual(seen, [['A', 'today'], ['B', 'today'], ['C', 'today']]);
  offA(); offB(); offC();
  requestFamilySpaceRefresh(null);
  assert.equal(seen.length, 3);

  assert.equal(shouldRefreshFamilySpace(null, 1_000), true);
  assert.equal(shouldRefreshFamilySpace(1_000, 1_000 + FAMILY_SPACE_REFRESH_THROTTLE_MS - 1), false);
  assert.equal(shouldRefreshFamilySpace(1_000, 1_000 + FAMILY_SPACE_REFRESH_THROTTLE_MS), true);
});

test('Today and Boundaries re-read the space and hold log; leaving re-counts members first', () => {
  const hook = read('src/hooks/useFamilySpace.ts');
  assert.match(hook, /AppState\.addEventListener\('change'/);
  assert.match(hook, /subscribeFamilySpaceRefresh\(/);
  assert.match(hook, /if \(!silent && generation === loadGeneration\.current\) \{\s*setSpace\(null\);/, 'a failed background read keeps the space');
  assert.match(hook, /select\('id', \{ count: 'exact', head: true \}\)/);
  const holdLog = read('src/hooks/useHoldLog.ts');
  assert.match(holdLog, /AppState\.addEventListener\('change'/);
  assert.match(holdLog, /if \(!mineError\) setOwn/);

  const boundaries = read('app/(tabs)/boundaries.tsx');
  assert.match(boundaries, /void refreshFamilySpace\(\);\s*void reloadHoldLog\(\)/);
  assert.match(boundaries, /const freshCount = await fetchMemberCount\(spaceId\);\s*const alone = \(freshCount \?\? knownMembers\) <= 1;/);
  assert.match(boundaries, /onPress=\{\(\) => void confirmLeaveFamilySpace\(familySpace\.id, familySpace\.members\.length\)\}/);
  const today = read('app/(tabs)/index.tsx');
  assert.match(today, /useFocusEffect\(\s*useCallback\(\(\) => \{\s*void refreshFamilySpace\(\);\s*void reloadHoldLog\(\)/);

  const push = read('src/hooks/usePushNotifications.ts');
  assert.match(push, /if \(data\.kind === 'family_backup'\) requestFamilySpaceRefresh\(\);/);
});

// ── 4. Loved-one status can come back down ─────────────────────────────────
test('choosing treatment or recovery clears a stale active-use status; other phases leave it', () => {
  for (const status of ['escalating', 'crisis', 'using']) {
    assert.deepEqual(pathwayPhaseUpdate('in_treatment', status), { stage: 'in_treatment', status: 'in_treatment' });
    for (const phase of ['returning_home', 'early_recovery_30', 'early_recovery_90', 'ongoing_recovery'] as const) {
      assert.deepEqual(pathwayPhaseUpdate(phase, status), { stage: phase, status: 'stable' });
    }
    for (const phase of ['active_use', 'considering_treatment', 'return_to_use', 'unsure'] as const) {
      assert.deepEqual(pathwayPhaseUpdate(phase, status), { stage: phase });
    }
  }
  for (const status of ['stable', 'in_treatment', 'unknown', null, undefined]) {
    for (const phase of RECOVERY_PHASES) assert.deepEqual(pathwayPhaseUpdate(phase, status), { stage: phase });
  }
  // Every status written is one loved_ones.status allows.
  const allowed = new Set(['stable', 'in_treatment', 'unknown', 'using', 'escalating', 'crisis']);
  for (const phase of RECOVERY_PHASES) {
    const status = pathwayPhaseUpdate(phase, 'crisis').status;
    if (status) assert.ok(allowed.has(status));
  }
  const today = read('app/(tabs)/index.tsx');
  assert.match(today, /saveLovedOne\(pathwayPhaseUpdate\(stage, lovedOneStatus\)\)/);
});

test('the tracker escalates a new warning spike once, never one already logged when it loads', () => {
  const step = (memory: TrackerSpikeMemory, count: number, status: string | null = 'stable') => nextTrackerSpike(memory, count, 3, status);
  // Loaded with three signs already logged (e.g. before "in treatment"): no write.
  let r = step(INITIAL_TRACKER_SPIKE_MEMORY, 3);
  assert.equal(r.action, 'none');
  r = step(r.memory, 4);
  assert.equal(r.action, 'none');
  // Drops below, then a new spike: escalate once.
  r = step(r.memory, 2);
  assert.equal(r.action, 'none');
  r = step(r.memory, 3);
  assert.equal(r.action, 'escalate');
  r = step(r.memory, 4);
  assert.equal(r.action, 'none');
  // A new spike while already raised only refreshes.
  r = step(step(r.memory, 1).memory, 3, 'crisis');
  assert.equal(r.action, 'refresh');
  // Loaded below the threshold, member logs the third sign: escalate.
  assert.equal(step(step(INITIAL_TRACKER_SPIKE_MEMORY, 2).memory, 3).action, 'escalate');
  const tracker = read('app/(tabs)/tracker.tsx');
  assert.match(tracker, /nextTrackerSpike\(spikeMemoryRef\.current, warnCount, ALERT_THRESHOLD, current\)/);
});

// ── 5. Family Squares RSVP and live hour ────────────────────────────────────
test('onboarding saves a spot only at The Family Squares', () => {
  const screen = read('app/(onboarding)/notifications.tsx');
  assert.match(screen, /supabase\.rpc\('family_squares_session_id'\)/);
  assert.doesNotMatch(screen, /\.eq\('kind', 'group'\)/);
  assert.match(screen, /\{nextGroupId && \(\s*<Text[^>]*>\s*\{t\('common:familySquares\.rsvpNote'\)\}/);
});

test('Today offers The Family Squares during its live hour', () => {
  const fs = { id: 'fs', title: 'The Family Squares', next_at: '2026-10-06T02:00:00Z' };
  const other = { id: 'g2', title: 'First 90 Days After Intervention', next_at: '2026-10-06T03:30:00Z' };
  const later = { id: 'g3', title: 'Boundaries Night', next_at: '2026-10-08T02:00:00Z' };
  const sessions = [fs, other, later];
  assert.equal(chooseFreeCall(sessions, new Date('2026-10-06T02:20:00Z'))?.id, 'fs', 'live: still offered');
  assert.equal(chooseFreeCall(sessions, new Date('2026-10-06T01:00:00Z'))?.id, 'fs', 'upcoming');
  assert.equal(chooseFreeCall(sessions, new Date('2026-10-06T03:00:00Z'))?.id, 'g2', 'its hour is over');
  assert.equal(chooseFreeCall([other, { ...fs, next_at: '2026-10-06 02:00:00+00' }], new Date('2026-10-06T02:59:00Z'))?.id, 'fs', 'Postgres text form');
  assert.equal(chooseFreeCall(sessions, new Date('2026-10-09T00:00:00Z'))?.id, 'fs', 'nothing upcoming: soonest listed');
  assert.equal(chooseFreeCall([], new Date()), null);
  assert.equal(isCallInProgress(fs.next_at, new Date('2026-10-06T02:00:00Z')), true);
  assert.equal(isCallInProgress(fs.next_at, new Date('2026-10-06T03:00:00Z')), false);
  assert.equal(isCallInProgress(null), false);
  assert.match(read('src/hooks/useTodayFeed.ts'), /const chosen = chooseFreeCall\(groups, now\);/);
});

// ── 7/8. Localized groups and a confirmed boundary delete ──────────────────
test('support group names, schedule and online counts come from the locale files', () => {
  for (const lang of ['en', 'es']) {
    const support = JSON.parse(read(`src/locales/${lang}/support.json`));
    const t = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], support) as string;
    const groups = getSupportGroups(t);
    assert.equal(groups.length, 4);
    for (const group of groups) {
      assert.ok(group.name && !group.name.startsWith('groups.'), `${lang}: ${group.id} name`);
      assert.equal(group.scheduleLabel, support.groups.weeklyModerated);
    }
    assert.match(support.groups.online_one, /\{\{count\}\}/);
    assert.match(support.groups.online_other, /\{\{count\}\}/);
  }
  const es = JSON.parse(read('src/locales/es/support.json'));
  assert.notEqual(es.groups.names.parents, 'Parents of Addicted Young Adults');
  const catalog = read('src/content/supportGroups.ts');
  assert.doesNotMatch(catalog, /name: '|Weekly · moderated/);
  const screen = read('app/(tabs)/support.tsx');
  assert.doesNotMatch(screen, /\} online`/);
  assert.match(screen, /t\('groups\.online', \{ count: group\.onlineCount \}\)/);
  assert.match(read('app/enabling-costs.tsx'), /accessibilityLabel=\{t\('back'\)\}/);
});

test('removing a boundary asks first', () => {
  const list = read('src/components/boundaries/WallsList.tsx');
  assert.match(list, /onPress=\{\(\) => confirmDelete\(wall\)\}/);
  assert.match(list, /appAlert\(t\('walls\.deleteTitle'\), t\('walls\.deleteBody'\), \[\s*\{ text: t\('walls\.deleteCancel'\), style: 'cancel' \},\s*\{ text: t\('walls\.deleteConfirm'\), style: 'destructive', onPress: \(\) => onDelete\(wall\.id\) \}/);
  for (const lang of ['en', 'es']) {
    const walls = JSON.parse(read(`src/locales/${lang}/boundaries.json`)).walls;
    for (const key of ['deleteTitle', 'deleteBody', 'deleteCancel', 'deleteConfirm']) assert.ok(walls[key], `${lang} walls.${key}`);
  }
});

// ── 10. Review notes ────────────────────────────────────────────────────────
test('App Review notes explain website coaching, IAP-only memberships and hidden purchase links', () => {
  const notes = read('docs/appstore-review-notes.md');
  assert.match(notes, /3\.1\.3\(d\)/);
  assert.match(notes, /soberhelpline\.com\/book-consultation/);
  assert.match(notes, /only through Apple in-app purchase/i);
  assert.match(notes, /hide[sn]? (all )?membership purchase links/i);
});
