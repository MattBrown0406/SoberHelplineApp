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
    assert.match(locale('support').peopleAccess, /\{\{rate\}\}/);
    assert.match(read('app/(tabs)/support.tsx'), /t\('peopleAccess', \{ rate: coachingRate\.hourly \}\)/);
    assert.ok(locale('common').navPurpose.scripts);
  });
}
test('Tools routes preserve distinct intent and paid gate contract', () => {
  const screen = read('app/(tabs)/learn.tsx');
  // Boundaries is a part of Practice now: the destination opens Practice on it.
  for (const route of ['/(tabs)/scripts', '/(tabs)/scripts?section=boundaries', '/finder', '/(tabs)/support']) assert.ok(screen.includes(route));
  assert.ok(screen.includes("useFeatureAccess('diyIntervention')"));
  assert.ok(screen.includes("canUseDiyIntervention ? 'tools.diyIncluded' : 'tools.diyPaid'"));
  assert.ok(screen.includes('entitlements.canAccessLearningContent ?'));
  assert.ok(read('app/diy-intervention-planner.tsx').includes('diyIntervention'));
});
test('crisis entry stays unconditional and safe-area tab height remains fixed', () => {
  const screen = read('app/(tabs)/support.tsx');
  // One crisis row, unconditional, before anything that depends on her account.
  const crisisRow = screen.indexOf('onPress={() => setCrisisOpen(true)}');
  assert.ok(crisisRow > 0);
  assert.equal(screen.split('setCrisisOpen(true)').length - 1, 1);
  const header = screen.indexOf("<TabHeader title={t('header')} />");
  const firstBranch = Math.min(...['{freeTier', '{isAttached &&', '{hasMembershipAccess &&', '{!hasMembershipAccess &&']
    .map((branch) => screen.indexOf(branch, header)).filter((at) => at > 0));
  assert.ok(header > 0 && header < crisisRow && crisisRow < firstBranch);
  // The note that crisis help is free, and the crisis guide, are in the sheet the row opens.
  const sheet = read('src/components/support/CrisisSheet.tsx');
  assert.ok(sheet.includes("{t('crisis.freeNote')}"));
  assert.ok(sheet.includes('{guideOpen && <CrisisGuide />}'));
  const tabs = read('app/(tabs)/_layout.tsx');
  assert.ok(tabs.includes('height: TAB_BAR_HEIGHT + insets.bottom'));
  assert.match(read('src/components/ui/ScreenContainer.tsx'), /export const TAB_BAR_HEIGHT = 64;/);
  assert.ok(tabs.includes('paddingBottom: insets.bottom + 6'));
  // A tab's name stays whole on one line: it shrinks to fit instead of being cut off.
  assert.ok(tabs.includes('numberOfLines={1}'));
  assert.ok(tabs.includes('adjustsFontSizeToFit'));
});
