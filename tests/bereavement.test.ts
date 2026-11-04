import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GRIEF_RESOURCES, isBereaved } from '../src/lib/bereavement';

const read = (path: string) => readFileSync(path, 'utf8');

test('she is bereaved only once a death date is on her loved-one record', () => {
  assert.equal(isBereaved(null), false);
  assert.equal(isBereaved(undefined), false);
  assert.equal(isBereaved({}), false);
  assert.equal(isBereaved({ died_at: null }), false);
  assert.equal(isBereaved({ died_at: '' }), false);
  assert.equal(isBereaved({ died_at: '2026-11-04T18:00:00Z' }), true);
  for (const resource of GRIEF_RESOURCES) assert.match(resource.url, /^https:\/\//);
});

test('the device remembers it per account, and the deletion purge removes it', async () => {
  const { bereavedCacheKey } = await import('../src/lib/bereavement');
  const { accountLocalKeys } = await import('../src/lib/accountLocalKeys');
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(accountLocalKeys([bereavedCacheKey(id), bereavedCacheKey('22222222-2222-4222-8222-222222222222')], [id]), [bereavedCacheKey(id)]);
  const hook = read('src/hooks/useLovedOne.ts');
  // Refreshing a loaded record is silent: no loading flash, a failed refresh keeps the record.
  assert.match(hook, /const silent = settledFor\.current === accountId;/);
  assert.match(hook, /if \(!silent && scopeRef\.current === scope && scope\.request === request\) setLoadError\(error\);/);
  assert.match(hook, /bereaved: settled \? isBereaved\(record\.value\) : cachedBereaved \?\? \(unreadable \? false : undefined\),/);
  // '0' is written for a known non-bereaved read; a missing key stays unknown.
  assert.match(hook, /bereaved \? '1' : '0'/);
  assert.match(hook, /value === '1' \? true : value === '0' \? false : undefined/);
  assert.match(hook, /rememberBereaved\(accountId, true\);/);
  assert.match(hook, /rememberBereaved\(accountId, false\);/);
});

test('the grief card and sheet copy exist in both languages, with 988 and the two groups', () => {
  for (const lang of ['en', 'es']) {
    const today = JSON.parse(read(`src/locales/${lang}/today.json`)).bereavement;
    const settings = JSON.parse(read(`src/locales/${lang}/settings.json`)).bereavement;
    assert.equal(today.grief.paragraphs.length, 3, lang);
    assert.match(today.grief.crisisBody, /988/, lang);
    assert.doesNotMatch(today.grief.crisisBody, /overdose|sobredosis/, `${lang}: fits any death from addiction`);
    for (const resource of GRIEF_RESOURCES) assert.ok(today.grief[resource.key].button, `${lang} ${resource.key}`);
    for (const key of ['title', 'body', 'contact', 'confirm', 'cancel', 'error']) assert.ok(today.sheet[key], `${lang} sheet.${key}`);
    for (const key of ['tell', 'undo', 'undoTitle', 'undoBody', 'undoConfirm', 'bereavedBody']) assert.ok(settings[key], `${lang} settings.${key}`);
  }
  const en = JSON.parse(read('src/locales/en/today.json')).bereavement;
  assert.doesNotMatch(JSON.stringify(en), /\b(he|she|him|his)\b/i, 'they/them for the loved one');
});

test('Today, the cards, Settings and Admin are wired', () => {
  const today = read('app/(tabs)/index.tsx');
  assert.match(today, /const bereaved = bereavedState === true;/);
  assert.match(today, /if \(bereavedUnknown\) \{\s*return \(\s*<ScreenContainer[^>]*>\s*\{header\}\s*<\/ScreenContainer>/);
  assert.match(today, /<NeedsRouter bereaved \/>/);
  assert.match(today, /primaryDoor=\{bereaved \? 'free_call' : primaryDoor\}/);
  // Crisis Mode is about the loved one: bereaved, she gets 911 / 988 for herself.
  const router = read('src/components/today/NeedsRouter.tsx');
  assert.match(router, /if \(bereaved\) return <EmergencyActions \/>;/);
  // No App Store rating prompt for a bereaved member, from Today or anywhere.
  assert.equal((today.match(/bereaved,\n|bereaved \}/g) ?? []).length >= 3, true);
  const prompt = read('src/lib/reviewPrompt.ts');
  assert.match(prompt, /from\('loved_ones'\)\.select\('died_at'\)/);
  assert.match(prompt, /bereaved: authoritativeSafety\.bereaved \|\| safety\?\.bereaved/);
  assert.match(today, /if \(bereaved\) \{[\s\S]*<GriefCard \/>/);
  assert.match(today, /bereaved \? null : takeaway/);
  assert.match(today, /onTheyDied=\{\(\) => setDiedSheetOpen\(true\)\}/);
  assert.match(today, /refreshLovedOne\(\)/);
  assert.match(read('src/components/today/LovedOneCheckCard.tsx'), /t\('bereavement\.link'\)/);
  assert.match(read('src/components/today/RecoveryPathwayCard.tsx'), /t\('bereavement\.link'\)/);
  assert.match(read('app/settings.tsx'), /<BereavementSettingsCard accountId=/);
  assert.match(read('app/admin.tsx'), /<BereavementContactsCard \/>/);
  const hook = read('src/hooks/useLovedOne.ts');
  assert.match(hook, /rpc\('mark_loved_one_died', \{ p_contact: contact \}\)/);
  assert.match(hook, /rpc\('clear_loved_one_died'\)/);
  // The sheet asks permission to reach out, on by default.
  assert.match(read('src/components/bereavement/BereavementSheet.tsx'), /setContact\(true\)/);
});

test('the server marks her own account only and stops the notes about the loved one', () => {
  const sql = read('supabase/migrations/20261105120000_bereavement.sql');
  assert.match(sql, /FUNCTION public\.mark_loved_one_died\(p_contact boolean DEFAULT false\)/);
  assert.match(sql, /v_account uuid := public\.my_account_id\(\);/);
  assert.doesNotMatch(sql, /mark_loved_one_died\(p_account/);
  assert.match(sql, /IF o\.kind IN \('invitation_window','practice_incoming'\) AND _account_bereaved\(a\.id\) THEN RETURN NULL/);
  assert.match(sql, /WHEN 'admin_bereavement' THEN/);
  // Not skipped: a neutral morning line instead of the boundaries challenge, Monday's call note kept.
  const morning = read('supabase/functions/notify-daily-morning/index.ts');
  assert.doesNotMatch(morning, /\|\| a\.bereaved\)/);
  assert.match(morning, /const copy = isMonday\s*\? \{ title: c\.mondayTitle, body: c\.mondayBody \}\s*: bereaved\s*\? \{ title: c\.morningTitle, body: c\.genericMorning \}/);
  assert.match(morning, /morningNoteData\(isMonday \|\| support \|\| bereaved \? 'support' : 'boundaries'\)/);
  assert.match(read('supabase/functions/_shared/legacy-sender-boundary.ts'), /status_changed_at, died_at\)/);
});

test('a bereaved member is never asked for a rating, and the admin alert opens Admin', async () => {
  const { reviewPromptDecision } = await import('../src/lib/reviewPromptPolicy');
  const { getPushDestination } = await import('../src/lib/pushRouting');
  const decision = reviewPromptDecision({ state: { schemaVersion: 1, attempts: [] }, appVersion: '4.2.0', safety: { bereaved: true, situationBand: 'calm' } });
  assert.deepEqual(decision, { eligible: false, reason: 'bereaved' });
  assert.deepEqual(getPushDestination({ kind: 'admin_bereavement', member_account_id: '27000000-0000-0000-0000-000000000001' }), { pathname: '/admin' });
});
