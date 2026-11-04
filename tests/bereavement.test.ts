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

test('the grief card and sheet copy exist in both languages, with 988 and the two groups', () => {
  for (const lang of ['en', 'es']) {
    const today = JSON.parse(read(`src/locales/${lang}/today.json`)).bereavement;
    const settings = JSON.parse(read(`src/locales/${lang}/settings.json`)).bereavement;
    assert.equal(today.grief.paragraphs.length, 3, lang);
    assert.match(today.grief.crisisBody, /988/, lang);
    for (const resource of GRIEF_RESOURCES) assert.ok(today.grief[resource.key].button, `${lang} ${resource.key}`);
    for (const key of ['title', 'body', 'contact', 'confirm', 'cancel', 'error']) assert.ok(today.sheet[key], `${lang} sheet.${key}`);
    for (const key of ['tell', 'undo', 'undoTitle', 'undoBody', 'undoConfirm', 'bereavedBody']) assert.ok(settings[key], `${lang} settings.${key}`);
  }
  const en = JSON.parse(read('src/locales/en/today.json')).bereavement;
  assert.doesNotMatch(JSON.stringify(en), /\b(he|she|him|his)\b/i, 'they/them for the loved one');
});

test('Today, the cards, Settings and Admin are wired', () => {
  const today = read('app/(tabs)/index.tsx');
  assert.match(today, /const bereaved = isBereaved\(lovedOne\);/);
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
  assert.match(read('supabase/functions/notify-daily-morning/index.ts'), /a\.bereaved\)/);
  assert.match(read('supabase/functions/_shared/legacy-sender-boundary.ts'), /status_changed_at, died_at\)/);
});
