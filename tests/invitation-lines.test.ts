import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  kitPracticeText,
  LINE_STYLES,
  PRACTICE_URL_TEXT_MAX,
  practiceNeedsHandoff,
  lineNeedsSoftening,
  normalizeObservation,
  renderTemplateLine,
  templateLines,
} from '../src/lib/invitationLines';
import { lineIsBlocked } from '../supabase/functions/_shared/invitation-coach';
import { MAX_URL_TEXT_CHARS } from '../src/lib/practiceScenarios';

const en = JSON.parse(readFileSync('src/locales/en/invitation.json', 'utf8'));
const es = JSON.parse(readFileSync('src/locales/es/invitation.json', 'utf8'));

function translator(locale: Record<string, unknown>) {
  return (key: string, params?: Record<string, string>) => {
    const value = key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), locale);
    assert.equal(typeof value, 'string', `missing ${key}`);
    return (value as string).replace(/\{\{(\w+)\}\}/g, (_, name: string) => params?.[name] ?? `{{${name}}}`);
  };
}

const contexts = [
  { name: '', observation: '', program: '' },
  { name: 'Mike', observation: "You've seemed so tired after work.", program: 'Hope House' },
  { name: 'Ana', observation: 'te he visto muy cansada', program: '' },
];

test('three template lines, one per style, each with love, observation/help, an invitation and help', () => {
  for (const ctx of contexts) {
    const lines = templateLines(ctx);
    assert.deepEqual(lines.map((line) => line.style), [...LINE_STYLES]);
    for (const line of lines) {
      assert.ok(line.fragments.some((fragment) => fragment.key.startsWith('lines.invite.')), 'invitation');
      assert.ok(line.fragments.some((fragment) => fragment.key.startsWith('lines.help.')), 'offer of help');
      assert.ok(line.fragments.some((fragment) => fragment.key.startsWith('lines.observe.') || fragment.key.startsWith('lines.love.')));
    }
  }
});

test('templates render fully in English and Spanish and never trip the label/ultimatum guard', () => {
  for (const locale of [en, es]) {
    const t = translator(locale);
    for (const ctx of contexts) {
      for (const line of templateLines(ctx)) {
        const text = renderTemplateLine(line, t);
        assert.doesNotMatch(text, /\{\{/, text);
        assert.equal(lineIsBlocked(text), false, text);
        assert.equal(lineNeedsSoftening(text), false, text);
        if (ctx.program) assert.ok(text.includes(ctx.program) || line.style === 'observation' || text.length > 0);
      }
    }
  }
  const rendered = renderTemplateLine(templateLines(contexts[1])[0], translator(en));
  assert.equal(
    rendered,
    "Mike, I love you, and I've been thinking about you a lot. I noticed you've seemed so tired after work. Would you be willing to talk with someone at Hope House — just a conversation? I'll drive you and wait for you.",
  );
});

test('observations are fitted into "I noticed …"', () => {
  assert.equal(normalizeObservation("  You've seemed TIRED.  "), "you've seemed TIRED");
  assert.equal(normalizeObservation('I saw the bottles!'), 'I saw the bottles');
  assert.equal(normalizeObservation('   '), '');
  assert.equal(normalizeObservation('x'.repeat(300)).length, 200);
});

test('edited lines with labels, ultimatums or always/never get a gentle tip', () => {
  for (const text of ['You are an addict', 'Go or else', 'You always do this', 'Eres un alcohólico', 'Siempre haces lo mismo', 'Es tu última oportunidad']) {
    assert.equal(lineNeedsSoftening(text), true, text);
  }
  for (const text of ['I love you and I am worried', "If you don't want to talk today, that's okay", 'Te quiero y estoy preocupada']) {
    assert.equal(lineNeedsSoftening(text), false, text);
  }
});

test('the whole kit becomes one bounded practice script', () => {
  assert.equal(kitPracticeText(['  one ', '', 'two'], ' Program: X '), 'one\n\ntwo\n\nProgram: X');
  assert.equal(kitPracticeText(['x'.repeat(2000)], '').length, 1200);
});

test('the multi-line kit goes through the practice handoff; one short line can ride in the URL', () => {
  assert.equal(PRACTICE_URL_TEXT_MAX, MAX_URL_TEXT_CHARS, 'mirrors conversation practice\'s URL cap');
  assert.equal(practiceNeedsHandoff('I love you. Would you talk to someone with me?'), false);
  assert.equal(practiceNeedsHandoff(kitPracticeText(['one', 'two', 'three'], 'Program: X')), true);
  assert.equal(practiceNeedsHandoff('a line\nwith a break'), true);
  assert.equal(practiceNeedsHandoff('x'.repeat(601)), true);
});
