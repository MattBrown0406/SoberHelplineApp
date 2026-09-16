import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorBoundaryCopy } from '../src/lib/errorBoundaryCopy';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = resolve(ROOT, 'src/locales');

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function flatten(value: Json, prefix = '', out = new Map<string, Json>()): Map<string, Json> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

function load(lang: string, file: string): Map<string, Json> {
  return flatten(JSON.parse(readFileSync(resolve(LOCALES, lang, file), 'utf8')) as Json);
}

// Strings that are legitimately identical in both languages: proper nouns,
// numbers, icons, URLs, and short labels that Spanish borrows unchanged.
const SAME_OK = /^(\s*|[\d\s.:–—-]+|[^A-Za-z]*|(\{\{[\w.]+\}\}[^A-Za-z]*)+|https?:\/\/.*|911|988|OK|Zoom|Premier|Essential|Narcan|LiveKit|Sober Helpline.*|The Family Squares|FamilyBridge|iOS|Android|PDF|Email|Wi-Fi|Mac|No|Total|Freedom Interventions.*|The Party Wreckers.*|No More Enabling.*|SAMHSA.*)$/i;

const files = readdirSync(resolve(LOCALES, 'en')).filter((name) => name.endsWith('.json')).sort();

test('every English locale file has a Spanish twin and no file exists in only one language', () => {
  assert.ok(files.length >= 20, 'expected the full namespace set');
  assert.deepEqual(readdirSync(resolve(LOCALES, 'es')).filter((name) => name.endsWith('.json')).sort(), files);
});

test('every locale file is registered with i18next', () => {
  const registry = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');
  for (const file of files) {
    const ns = file.replace(/\.json$/, '');
    assert.match(registry, new RegExp(`locales/en/${ns}\\.json`), `${ns} not imported for en`);
    assert.match(registry, new RegExp(`locales/es/${ns}\\.json`), `${ns} not imported for es`);
  }
});

for (const file of files) {
  test(`en/${file} and es/${file} have identical keys, shapes, and placeholders`, () => {
    const en = load('en', file);
    const es = load('es', file);
    assert.deepEqual([...es.keys()].sort(), [...en.keys()].sort(), 'key sets differ');
    for (const [key, enValue] of en) {
      const esValue = es.get(key);
      assert.equal(typeof esValue, typeof enValue, `${key}: type differs`);
      if (typeof enValue !== 'string' || typeof esValue !== 'string') continue;
      assert.equal(esValue.trim().length > 0, enValue.trim().length > 0, `${key}: one side is empty`);
      const placeholders = (value: string) => (value.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();
      assert.deepEqual(placeholders(esValue), placeholders(enValue), `${key}: interpolation placeholders differ`);
      for (const number of ['911', '988']) {
        assert.equal(esValue.includes(number), enValue.includes(number), `${key}: crisis number ${number} must appear in both languages`);
      }
    }
  });
}

test('Spanish copy is translated, not copied through', () => {
  const untranslated: string[] = [];
  let compared = 0;
  for (const file of files) {
    const en = load('en', file);
    const es = load('es', file);
    for (const [key, enValue] of en) {
      if (typeof enValue !== 'string' || enValue.split(/\s+/).length < 3) continue;
      compared += 1;
      if (es.get(key) === enValue && !SAME_OK.test(enValue)) untranslated.push(`${file}:${key}`);
    }
  }
  assert.ok(compared > 500, `only ${compared} multi-word strings compared`);
  assert.deepEqual(untranslated, [], 'multi-word strings identical in en and es');
});

test('the crash fallback renders in Spanish with the crisis numbers intact', () => {
  const es = errorBoundaryCopy('es-MX');
  const en = errorBoundaryCopy('en');
  assert.notEqual(es.title, en.title);
  assert.notEqual(es.body, en.body);
  assert.notEqual(es.retry, en.retry);
  assert.ok(es.body.includes('988') && es.body.includes('911'));
  assert.deepEqual(errorBoundaryCopy(undefined), en);
  assert.deepEqual(errorBoundaryCopy('fr'), en);
});

test('no member-facing screen switches copy with an isSpanish ternary', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) { if (!/admin/.test(entry.name)) walk(path); continue; }
      if (!/\.tsx?$/.test(entry.name) || /admin/.test(entry.name)) continue;
      const source = readFileSync(path, 'utf8');
      // A locale *value* (e.g. consentLocale={isSpanish ? 'es' : 'en'}) is fine; copy is not.
      if (/isSpanish\s*\?\s*['"`](?!(es|en)['"`])/.test(source)) offenders.push(path.slice(ROOT.length + 1));
    }
  };
  walk(resolve(ROOT, 'app'));
  walk(resolve(ROOT, 'src/components'));
  walk(resolve(ROOT, 'src/hooks'));
  assert.deepEqual(offenders, []);
});
