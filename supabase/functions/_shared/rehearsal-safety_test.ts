import { normalizeDebrief, userInCrisis } from './rehearsal-safety.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test('first-person crisis disclosures break character (EN)', () => {
  for (const text of [
    'Honestly I want to kill myself some days.',
    "I don't want to live anymore.",
    'i dont want to be here',
    "I'm suicidal and I don't know what to do",
    'I am going to die if this keeps up',
    "He's hitting me right now",
  ]) assert(userInCrisis(text), text);
});

Deno.test('first-person crisis disclosures break character (ES)', () => {
  for (const text of [
    'A veces quiero matarme.',
    'No quiero vivir más.',
    'no quiero estar aquí',
    'Voy a morir si esto sigue',
    'Me está pegando ahora mismo',
  ]) assert(userInCrisis(text), text);
});

Deno.test('rehearsal lines about the addiction do not stop practice', () => {
  for (const text of [
    "I don't want to live like this anymore — I need you to get help.",
    'No quiero vivir así, necesito que aceptes ayuda.',
    'When you overdosed last year I thought you would die.',
    'Your drinking is killing this family.',
    "I won't cover for you anymore.",
    'Estoy muriendo de miedo por ti',
  ]) assert(!userInCrisis(text), text);
});

Deno.test('debrief from the model is coerced to the rendered shape', () => {
  const d = normalizeDebrief({ wentWell: 'Led with love', workOn: ['a', 'b', 'c'], scores: { love: '9', ask: 0, calm: 'x' } });
  assertEquals(d, {
    wentWell: ['Led with love'],
    workOn: ['a', 'b'],
    drill: '',
    scores: { love: 5, ask: 1, boundaries: 3, calm: 3 },
  });
  assertEquals(normalizeDebrief({ wentWell: [], workOn: [] }), null);
  assertEquals(normalizeDebrief('not json'), null);
});
