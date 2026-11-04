import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultProsecutorLetter,
  PROSECUTOR_DETAIL_LIMIT,
  PROSECUTOR_INPUT_MAX_LENGTH,
  PROSECUTOR_PROTECTED_BYTE_LIMIT,
  PROSECUTOR_TEXT_KEYS,
  parseProsecutorLetter,
  prosecutorLetterProgress,
  prosecutorLetterProtectedByteLength,
  prosecutorLetterStarted,
  prosecutorLetterText,
  updateProsecutorLetter,
  type ProsecutorLetter,
} from '../src/lib/prosecutorLetter';
import { prosecutorLetterStorageKey } from '../src/lib/prosecutorLetterStorageKeys';

const read = (path: string) => readFileSync(path, 'utf8');
const copy = (lang: 'en' | 'es') => JSON.parse(read(`src/locales/${lang}/prosecutorLetter.json`));

/** A minimal i18next-style lookup over the namespace JSON. */
function translator(lang: 'en' | 'es') {
  const source = copy(lang);
  return (key: string, options: Record<string, unknown> = {}) => {
    const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], source);
    assert.equal(typeof value, 'string', `${lang}:${key}`);
    return (value as string).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
      assert.ok(name in options, `${lang}:${key} needs ${name}`);
      return String(options[name]);
    });
  };
}

function filled(): ProsecutorLetter {
  return updateProsecutorLetter(defaultProsecutorLetter(), {
    lovedOneName: 'Jordan Lee',
    caseNumber: 'Case 26-CR-01234, Marion County Circuit Court',
    prosecutor: 'Deputy District Attorney Jane Smith',
    program: 'Hope Recovery Center in Salem, 30-day residential',
    startDate: 'November 18, 2026',
    updates: 'every two weeks',
    attorney: 'Sam Rivera',
    yourName: 'Pat Lee',
    relationship: 'mother',
    contact: 'pat@example.com',
  });
}

test('the letter asks for treatment in place of jail, completion, written updates, and an in-person review of the charges', () => {
  const en = prosecutorLetterText(filled(), translator('en'), 'November 4, 2026');
  assert.match(en, /be allowed to enter treatment in place of jail while the charges in this case are pending/);
  assert.match(en, /We have arranged a place for Jordan Lee at Hope Recovery Center/);
  assert.match(en, /completes the full program, including the aftercare plan/);
  assert.match(en, /written progress updates to your office every two weeks/);
  assert.match(en, /leaves the program before completing it, your office is told right away/);
  assert.match(en, /meets in person with Jordan Lee's attorney[\s\S]*assess the change[\s\S]*whether continued prosecution of the pending charges is needed[\s\S]*whether the charges can be reduced/);
  assert.match(en, /Dear Deputy District Attorney Jane Smith:/);
  assert.match(en, /Re: Jordan Lee, Case 26-CR-01234/);
  assert.match(en, /Sam Rivera, has a copy of this letter/);
  assert.match(en, /Respectfully,\nPat Lee\nJordan Lee's mother\npat@example\.com$/);

  const es = prosecutorLetterText({ ...filled(), relationship: 'madre' }, translator('es'), '4 de noviembre de 2026');
  assert.match(es, /ingresar a tratamiento en lugar de ir a la cárcel mientras los cargos de este caso están pendientes/);
  assert.match(es, /completa todo el programa, incluido el plan de seguimiento/);
  assert.match(es, /informes escritos de progreso every two weeks/);
  assert.match(es, /se reúne en persona con la defensa de Jordan Lee[\s\S]*evaluar el cambio[\s\S]*continuar el proceso por los cargos pendientes[\s\S]*si los cargos pueden reducirse/);
  assert.match(es, /Atentamente,\nPat Lee\nmadre de Jordan Lee/);
});

test('blank details stay visible blanks, and the generic greeting is used without a prosecutor name', () => {
  for (const lang of ['en', 'es'] as const) {
    const t = translator(lang);
    const text = prosecutorLetterText(defaultProsecutorLetter(), t, 'today');
    for (const key of ['lovedOneName', 'caseNumber', 'program', 'startDate', 'updates', 'attorney', 'yourName', 'relationship'] as const) {
      assert.ok(text.includes(t(`letter.blank.${key}`)), `${lang} ${key}`);
    }
    assert.ok(text.includes(t('letter.greeting')), lang);
    assert.ok(!text.includes(t('letter.blank.contact')), `${lang}: no contact line when blank`);
  }
});

test('the letter is ready once every required detail is filled', () => {
  assert.equal(prosecutorLetterProgress(defaultProsecutorLetter()).ready, false);
  assert.equal(prosecutorLetterStarted(defaultProsecutorLetter()), false);
  const letter = filled();
  assert.equal(prosecutorLetterProgress(letter).ready, true);
  assert.equal(prosecutorLetterProgress(updateProsecutorLetter(letter, { prosecutor: '', contact: '' })).ready, true);
  for (const key of ['lovedOneName', 'caseNumber', 'program', 'startDate', 'updates', 'attorney', 'yourName', 'relationship'] as const) {
    assert.equal(prosecutorLetterProgress(updateProsecutorLetter(letter, { [key]: '  ' })).ready, false, key);
  }
});

test('stored letters round-trip, fail closed when damaged, and never throw at the budget', () => {
  const letter = filled();
  assert.deepEqual(parseProsecutorLetter(JSON.stringify(letter)), letter);
  assert.equal(parseProsecutorLetter(null).letterLanguage, 'en');
  assert.throws(() => parseProsecutorLetter('not json'), /invalid_json/);
  assert.throws(() => parseProsecutorLetter('{}'), /missing_field/);
  assert.throws(() => parseProsecutorLetter(JSON.stringify({ ...letter, program: 7 })), /invalid_field:program/);
  assert.throws(() => parseProsecutorLetter(JSON.stringify({ ...letter, letterLanguage: 'fr' })), /invalid_language/);
  assert.equal(parseProsecutorLetter(JSON.stringify({ ...letter, program: 'x'.repeat(500) })).program.length, PROSECUTOR_DETAIL_LIMIT);
  assert.ok(PROSECUTOR_PROTECTED_BYTE_LIMIT < 2048);
  let full = filled();
  for (const key of PROSECUTOR_TEXT_KEYS) full = updateProsecutorLetter(full, { [key]: 'é'.repeat(PROSECUTOR_INPUT_MAX_LENGTH) });
  assert.ok(prosecutorLetterProtectedByteLength(full) <= PROSECUTOR_PROTECTED_BYTE_LIMIT);
  assert.doesNotThrow(() => updateProsecutorLetter(full, { letterLanguage: 'es' }));
  // Plain English at the input limit fits untouched.
  let english = filled();
  for (const key of PROSECUTOR_TEXT_KEYS) english = updateProsecutorLetter(english, { [key]: 'x'.repeat(PROSECUTOR_INPUT_MAX_LENGTH) });
  for (const key of PROSECUTOR_TEXT_KEYS) assert.equal(english[key].length, PROSECUTOR_INPUT_MAX_LENGTH, key);
});

test('SecureStore keys are valid and account scoped', () => {
  const first = prosecutorLetterStorageKey('11111111-1111-4111-8111-111111111111');
  assert.notEqual(first, prosecutorLetterStorageKey('22222222-2222-4222-8222-222222222222'));
  assert.match(first, /^[A-Za-z0-9._-]+$/);
  assert.throws(() => prosecutorLetterStorageKey('account:unsafe'), /invalid_prosecutor_account_id/);
});

test('the screen tells her to go through the attorney, not to write about the case, and about the release', () => {
  const en = copy('en');
  const es = copy('es');
  assert.equal(en.before.length, es.before.length);
  assert.match(en.before.join(' '), /defense attorney first/);
  assert.match(en.before.join(' '), /Don't write about what happened/);
  assert.match(en.before.join(' '), /signs a release/);
  assert.match(es.before.join(' '), /abogado defensor/);
  assert.match(es.before.join(' '), /No escribas sobre lo que pasó/);
  assert.match(es.before.join(' '), /firme una autorización/);
  assert.match(en.legalNote, /not legal advice/);
  assert.match(es.legalNote, /no asesoría legal/);
});

test('route, storage, Tools, Crisis Mode, and account cleanup are wired', () => {
  const screen = read('app/prosecutor-letter.tsx');
  assert.match(screen, /useToolOpened\('prosecutor_letter'\)/);
  assert.match(screen, /logToolUsage\('prosecutor_letter', 'finished'\)/);
  assert.match(screen, /i18n\.getFixedT\(letter\.letterLanguage, 'prosecutorLetter'\)/);
  assert.match(screen, /shareOrCopy\(letterText/);
  assert.match(screen, /isSessionOnlyPlanStorage\(Platform\.OS\) \?[\s\S]{0,160}t\('webSessionNotice'\)/);
  assert.doesNotMatch(screen, /Alert\.alert\(/);
  assert.match(read('src/storage/prosecutorLetter.ts'), /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(read('src/hooks/useProsecutorLetter.ts'), /readVersion/);
  assert.match(read('app/(tabs)/learn.tsx'), /router\.push\('\/prosecutor-letter'/);
  assert.match(read('app/crisis-mode.tsx'), /situationKey === 'arrested' && \([\s\S]{0,300}router\.push\('\/prosecutor-letter'/);
  assert.match(read('src/lib/accountLocalData.ts'), /clearProtectedProsecutorLetter\(accountId\)/);
  assert.match(read('src/i18n/index.ts'), /prosecutorLetter: enProsecutorLetter/);
  assert.match(read('src/i18n/index.ts'), /prosecutorLetter: esProsecutorLetter/);
});
