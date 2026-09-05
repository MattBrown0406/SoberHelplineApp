import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const screen = fs.readFileSync(new URL('app/membership-guide.tsx', root), 'utf8');
const source = fs.readFileSync(new URL('src/membershipGuide/content.ts', root), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', compiled)(exports);
const copy = exports.membershipGuideContent;

test('English and Spanish provide the same complete written guide', () => {
  assert.deepEqual(Object.keys(copy.en).sort(), Object.keys(copy.es).sort());
  for (const c of Object.values(copy)) {
    for (const text of Object.values(c)) assert.ok(text.length > 0);
    assert.match(c.intro, /Matt Brown/);
    assert.match(c.intro, /22/);
    assert.match(c.safety, /911/);
    assert.match(c.exampleNote, /Matt/);
    assert.match(c.timing, /Essential/);
    assert.match(c.timing, /Premier/);
  }
  assert.equal(copy.en.title, 'Guidance for the family—not control over your loved one');
  assert.match(copy.en.exampleNote, /Not a testimonial or an actual message/);
  assert.match(copy.es.exampleNote, /No es un testimonio ni un mensaje real/);
  assert.match(copy.en.timing, /no fixed response-time guarantee/);
  assert.match(copy.es.timing, /No se garantiza un plazo fijo/);
});

test('safety and free practice precede commercial options; real routes exist', () => {
  for (const route of ['/crisis-mode', '/safety-wallet', '/free-practice', '/(tabs)/support']) {
    assert.ok(screen.includes(`router.push('${route}')`));
    assert.ok(fs.existsSync(new URL(`app${route}.tsx`, root)));
  }
  assert.ok(screen.indexOf('router.push(\'/safety-wallet\')') < screen.indexOf('heading(c.options)'));
  assert.ok(screen.indexOf('router.push(\'/free-practice\')') < screen.indexOf('heading(c.options)'));
});

test('uses canonical benefits, rate, account and store prices without purchasing', () => {
  for (const contract of ['walletMembershipCopy(i18n.language)', 'membership.essential', 'membership.premier', "membership.service.replaceAll('{rate}', COACHING_RATE_LABEL)", 'useAccount()', 'useIAP()', 'prices.essential', 'prices.premium', 'membership.priceUnavailable', 'retryPrices']) assert.ok(screen.includes(contract), contract);
  assert.doesNotMatch(screen, /purchaseEssential|purchasePremium|TextInput|sendMessage|VideoView|Audio|\$\d/);
  assert.doesNotMatch(screen, /if\s*\(!user\)|Redirect|numberOfLines/);
});

test('native scroll layout has accessible wrapping controls of at least 44 points', () => {
  assert.match(screen, /<ScreenContainer scroll/);
  assert.match(screen, /accessibilityRole="button" accessibilityLabel=\{label\}/);
  assert.match(screen, /accessibilityRole="header"/);
  assert.match(screen, /minHeight: 48/);
  assert.match(screen, /minWidth: 44/);
  assert.match(screen, /flexShrink: 1/);
  assert.doesNotMatch(screen, /width: 3\d\d|height: \d/);
});
