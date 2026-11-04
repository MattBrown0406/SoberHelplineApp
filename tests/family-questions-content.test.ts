import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  ALWAYS_RED_SITUATIONS,
  CRISIS_SITUATION_ORDER,
  assessSituationRisk,
  crisisEmergencyChecklist,
  getCrisisSituations,
} from '../src/content/crisisCopilot';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const learn = (lang: 'en' | 'es') =>
  JSON.parse(readFileSync(resolve(ROOT, `src/locales/${lang}/learn.json`), 'utf8')) as {
    faq: { items: { q: string; a: string }[] };
  };

const LIST_FIELDS = ['action', 'dont', 'next24', 'next72'] as const;

test('the arrested situation is offered right after money demands', () => {
  const index = CRISIS_SITUATION_ORDER.indexOf('arrested');
  assert.ok(index > 0, 'arrested is in the situation list');
  assert.equal(CRISIS_SITUATION_ORDER[index - 1], 'demands');
  assert.equal(new Set(CRISIS_SITUATION_ORDER).size, CRISIS_SITUATION_ORDER.length, 'no duplicates');
});

test('the arrested situation is complete in English and Spanish, and Spanish is translated', () => {
  const en = getCrisisSituations('en').arrested;
  const es = getCrisisSituations('es-MX').arrested;
  for (const situation of [en, es]) {
    assert.equal(situation.key, 'arrested');
    assert.ok(situation.label.trim() && situation.description.trim() && situation.say.trim());
    for (const field of LIST_FIELDS) {
      assert.ok(situation[field].length >= 3, `${field} has at least three steps`);
      for (const line of situation[field]) assert.ok(line.trim().length > 0, `${field} has no empty step`);
    }
  }
  assert.notEqual(es.label, en.label);
  assert.notEqual(es.description, en.description);
  assert.notEqual(es.say, en.say);
  for (const field of LIST_FIELDS) {
    assert.equal(es[field].length, en[field].length, `${field} has the same number of steps`);
    es[field].forEach((line, index) => assert.notEqual(line, en[field][index], `${field}[${index}] is translated`));
  }
});

test('the arrested guidance covers withdrawal, recorded calls, a lawyer, and overdose after release', () => {
  const en = getCrisisSituations('en').arrested;
  const all = [...en.action, ...en.dont, ...en.next24, ...en.next72, en.say].join(' ');
  for (const pattern of [/bail/i, /withdrawal/i, /recorded/i, /attorney|public defender/i, /drug court|diversion/i, /naloxone/i, /treatment/i]) {
    assert.match(all, pattern);
  }
  const es = getCrisisSituations('es').arrested;
  const allEs = [...es.action, ...es.dont, ...es.next24, ...es.next72, es.say].join(' ');
  for (const pattern of [/fianza/i, /abstinencia/i, /graban/i, /abogado|defensor público/i, /corte de drogas|desvío/i, /naloxona/i, /tratamiento/i]) {
    assert.match(allEs, pattern);
  }
});

test('an arrest is not an automatic red alert; danger questions still decide', () => {
  assert.ok(!ALWAYS_RED_SITUATIONS.includes('arrested'));
  assert.equal(assessSituationRisk('arrested', false, 0), 'GREEN');
  assert.equal(assessSituationRisk('arrested', true, 0), 'RED');
});

test('crisis mode renders situations from the shared order, so the new one shows', () => {
  const screen = readFileSync(resolve(ROOT, 'app/crisis-mode.tsx'), 'utf8');
  assert.match(screen, /CRISIS_SITUATION_ORDER\.map\(/);
});

test('the FAQ answers the arrest, court-ordered treatment, and medication questions in both languages', () => {
  const en = learn('en').faq.items;
  const es = learn('es').faq.items;
  assert.equal(es.length, en.length, 'same number of questions');
  const enQuestions = en.map((item) => item.q);
  for (const question of [
    "They've been arrested. Should we bail them out?",
    'Can we make them go to treatment?',
    "Isn't medication just trading one drug for another?",
  ]) {
    assert.ok(enQuestions.includes(question), `${question} is answered`);
  }
  const tail = (items: { q: string; a: string }[]) => items.slice(-3);
  const [arrestEn, commitmentEn, medicationEn] = tail(en);
  const [arrestEs, commitmentEs, medicationEs] = tail(es);
  assert.match(arrestEn.a, /Crisis Mode/);
  assert.match(arrestEs.a, /Modo Crisis/);
  for (const name of ['Marchman Act', "Casey's Law", 'Section 35']) {
    assert.ok(commitmentEn.a.includes(name) && commitmentEs.a.includes(name), `${name} named in both`);
  }
  assert.match(commitmentEn.a, /not legal advice/);
  assert.match(commitmentEs.a, /no asesoría legal/);
  for (const drug of [/buprenorphine/i, /methadone/i, /naltrexone/i]) assert.match(medicationEn.a, drug);
  for (const drug of [/buprenorfina/i, /metadona/i, /naltrexona/i]) assert.match(medicationEs.a, drug);
  for (const item of [...tail(en), ...tail(es)]) {
    const words = item.a.split(/\s+/).length;
    assert.ok(words >= 60 && words <= 140, `${item.q} answer is FAQ-sized (${words} words)`);
  }
});

test('an emergency during an arrest gets custody steps, not "stay with them" steps', () => {
  const screen = readFileSync('app/crisis-mode.tsx', 'utf8');
  // Steps and words come from the same choice.
  assert.match(screen, /const redChecklist = crisisEmergencyChecklist\(situationKey, selected\);/);
  assert.match(screen, /t\(redChecklist === 'redCustody' \? 'say\.redCustody' : 'say\.red'\)/);
  assert.equal(crisisEmergencyChecklist('arrested', { suicide: true }), 'redCustody');
  assert.equal(crisisEmergencyChecklist('arrested', {}), 'redCustody');
  // Out and near her: the at-the-scene steps.
  for (const tick of ['violence', 'weapons', 'drivingIntoxicated']) {
    assert.equal(crisisEmergencyChecklist('arrested', { suicide: true, [tick]: true }), 'redDefault', tick);
  }
  assert.equal(crisisEmergencyChecklist('arrested', { overdose: true }), 'redOverdose');
  assert.equal(crisisEmergencyChecklist('arrested', { notBreathing: true, suicide: true }), 'redOverdose');
  // Other situations are unchanged.
  assert.equal(crisisEmergencyChecklist('selfHarm', {}), 'redSuicide');
  assert.equal(crisisEmergencyChecklist('demands', { suicide: true }), 'redSuicide');
  assert.equal(crisisEmergencyChecklist('violence', {}), 'redDefault');
  assert.equal(crisisEmergencyChecklist('overdose', {}), 'redOverdose');
  for (const lang of ['en', 'es']) {
    const crisis = JSON.parse(readFileSync(`src/locales/${lang}/crisis.json`, 'utf8'));
    assert.equal(crisis.checklist.redCustody.length, 4, lang);
    assert.match(crisis.checklist.redCustody.join(' '), /911/, lang);
    assert.match(crisis.checklist.redCustody.join(' '), /988/, lang);
    assert.ok(crisis.say.redCustody, lang);
  }
});
