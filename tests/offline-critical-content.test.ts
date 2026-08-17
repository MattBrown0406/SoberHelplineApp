import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFile(resolve(root, path), 'utf8');

test('Scripts is bundled and does not mount network-backed personalization hooks', async () => {
  const code = await source('app/(tabs)/scripts.tsx');
  assert.match(code, /getScripts\(i18n\.language\)/);
  assert.match(code, /getDailyScripts\(localDailyScriptSlot\(\)/);
  assert.doesNotMatch(code, /useTodayFeed|useLovedOne|supabase/);
});

test('Crisis mode keeps local guidance and suppresses network-only support while offline', async () => {
  const code = await source('app/crisis-mode.tsx');
  assert.match(code, /getCrisisSituations\(language\)/);
  assert.match(code, /useSafetyWallet/);
  assert.match(code, /isOfflineAccountFallback \? null : user\?\.id/);
  assert.match(code, /!isOfflineAccountFallback \? \(/);
});

test('Treatment readiness plan is protected local storage, not a network prerequisite', async () => {
  const hook = await source('src/hooks/useTreatmentActionPlan.ts');
  assert.match(hook, /storage\/treatmentActionPlan/);
  assert.doesNotMatch(hook, /from\(['"]|supabase\.|functions\.invoke/);
});

test('Offline account fallback is wired only for connectivity failures and fails closed', async () => {
  const context = await source('src/contexts/AccountContext.tsx');
  const cache = await source('src/lib/offlineAccountCache.ts');
  assert.match(context, /if \(isOfflineFallbackError\(error\)\)/);
  assert.match(context, /restoreOfflineAccount\(sessionUser\.id\)/);
  assert.match(context, /restoreLastOfflineAccount\(\)/);
  assert.match(context, /withRequiredTimeout/);
  assert.match(context, /isAuthenticated: authUser !== null \|\| \(isOfflineAccountFallback && user !== null\)/);
  assert.match(context, /cacheWriteRef\.current = cacheWriteRef\.current/);
  assert.match(context, /isAdmin: !isOfflineAccountFallback && isAdminEmail/);
  assert.match(cache, /email: ''/);
  assert.match(cache, /accountState: 'direct-free'/);
  assert.match(cache, /entitlementsForAccountState\('direct-free'\)/);
  assert.match(cache, /code === 'pgrst116'.*return false/);
});
