import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const copy = (lang: 'en' | 'es') => JSON.parse(read(`src/locales/${lang}/chooseTreatment.json`));

test('the checklist asks about licensing, medication, mental health, family, aftercare and cost, and names the brokering red flags', () => {
  const en = copy('en');
  const asks = en.ask.map((item: { q: string }) => item.q).join(' ');
  for (const pattern of [/licensed by the state/, /Joint Commission or CARF/, /detox/, /buprenorphine/, /mental health/, /family program/, /aftercare/, /in writing/]) {
    assert.match(asks, pattern);
  }
  const flags = en.flags.join(' ');
  for (const pattern of [/free travel/, /We take all insurance/, /won't tell you the facility's name/, /Pressure to decide/, /patient brokering/]) {
    assert.match(flags, pattern);
  }
  assert.match(en.before.join(' '), /1-800-662-4357/);
  assert.match(en.before.join(' '), /FindTreatment\.gov/);
});

test('English and Spanish match item for item', () => {
  const en = copy('en');
  const es = copy('es');
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const key of ['ask', 'flags', 'before']) assert.equal(es[key].length, en[key].length, key);
  for (let i = 0; i < en.ask.length; i += 1) {
    assert.ok(es.ask[i].q && es.ask[i].why, `es ask ${i}`);
    assert.notEqual(es.ask[i].q, en.ask[i].q);
  }
  assert.match(es.before.join(' '), /1-800-662-4357/);
});

test('reachable from Tools, the finder and the arrest plan; the arrest plan also opens They Said Yes', () => {
  assert.match(read('app/(tabs)/learn.tsx'), /router\.push\('\/choose-treatment'/);
  assert.match(read('app/finder/index.tsx'), /router\.push\('\/choose-treatment'/);
  const crisis = read('app/crisis-mode.tsx');
  assert.match(crisis, /situationKey === 'arrested' && \([\s\S]{0,400}router\.push\('\/choose-treatment'/);
  assert.match(crisis, /pathname: '\/treatment-action-plan', params: \{ focus: 'yes', source: 'arrest' \}/);
  const screen = read('app/choose-treatment.tsx');
  assert.match(screen, /useToolOpened\('choose_treatment'\)/);
  assert.match(screen, /\{!isAttached && <ActionLink label=\{t\('bookSession'\)\}/);
  assert.match(read('src/i18n/index.ts'), /chooseTreatment: enChooseTreatment/);
  assert.match(read('src/i18n/index.ts'), /chooseTreatment: esChooseTreatment/);
});
