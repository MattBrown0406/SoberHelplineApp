import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
for (const lang of ['en', 'es']) {
  test(`${lang}: intent labels, boundary explanation and local pricing are translated`, () => {
    const locale = ns => JSON.parse(read(`src/locales/${lang}/${ns}.json`));
    for (const key of ['conversation', 'boundaries', 'treatment', 'someone']) assert.ok(locale('learn').destinations[key]);
    assert.match(locale('boundaries').intro, lang === 'en' ? /agreed boundaries/ : /límites acordados/);
    assert.match(locale('support').crisis.freeNote, lang === 'en' ? /free.*no subscription/ : /gratuitos.*sin suscripción/);
    assert.match(locale('learn').tools.diyPaid, /Essential.*Premier/);
    assert.match(locale('support').peopleAccess, /\$150/);
    assert.ok(locale('common').navPurpose.scripts);
  });
}
test('Tools routes preserve distinct intent and paid gate contract', () => {
  const screen = read('app/(tabs)/learn.tsx');
  for (const route of ['/(tabs)/scripts', '/(tabs)/boundaries', '/finder', '/(tabs)/support']) assert.ok(screen.includes(route));
  assert.ok(screen.includes("useFeatureAccess('diyIntervention')"));
  assert.ok(screen.includes("canUseDiyIntervention ? 'tools.diyIncluded' : 'tools.diyPaid'"));
  assert.ok(screen.includes('entitlements.canAccessLearningContent ?'));
  assert.ok(read('app/diy-intervention-planner.tsx').includes('diyIntervention'));
});
test('crisis entry stays unconditional and safe-area tab height remains fixed', () => {
  const screen = read('app/(tabs)/support.tsx');
  assert.ok(screen.indexOf("t('crisis.freeNote')") < screen.indexOf('{isAttached &&'));
  assert.ok(screen.includes('onPress={() => setCrisisOpen(true)}'));
  const tabs = read('app/(tabs)/_layout.tsx');
  assert.ok(tabs.includes('height: 64 + insets.bottom'));
  assert.ok(tabs.includes('paddingBottom: insets.bottom + 6'));
  assert.ok(tabs.includes('flexShrink: 0'));
});
