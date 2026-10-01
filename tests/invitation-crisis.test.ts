import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as client from '../src/lib/invitationCrisis';
import * as server from '../supabase/functions/_shared/invitation-crisis';
import * as clientScreen from '../src/lib/invitationScreen';
import * as serverScreen from '../supabase/functions/_shared/invitation-screen';
import { afterObservationEdit, invitationInCrisis, kitCrisisField, kitCrisisKey, kitCrisisState } from '../src/lib/invitationKitScreen';
import { crisisKind as clientCrisisKind } from '../src/lib/invitationUserCrisis';
import { crisisKind as serverCrisisKind, userInCrisis } from '../supabase/functions/_shared/rehearsal-safety';
import { safetyGateFrom, windowInviteAllowed } from '../src/lib/invitationSafetyGate';

// Violence, threats, weapons, self-harm — to, about, or from the loved one.
const CRISIS = [
  'you shoved me against the wall Saturday',
  "you said you'd kill yourself if I made you go",
  'You hit me last week',
  'he choked me',
  'he beat me up',
  'he grabbed my arm',
  'he threatened to kill himself',
  'you threatened me with a knife',
  'you talk about suicide',
  'he pulled a knife on me',
  'you came at me with a knife',
  // Audit round 3 misses.
  "he said he'd end it all",
  'he put a gun to his head',
  'he put his hands around my neck',
  'you broke my nose',
  'you threw your phone at me',
  'He kicked my dog',
  'my son shoved me',
  'my husband grabbed my throat',
  'me empujaste contra la pared',
  'me pegó el sábado',
  'dijiste que te matarías si te obligaba a ir',
  'amenazó con matarse',
  'amenazó con pegarme',
  'sacó una pistola',
  'dijo que se quiere matar',
  'me dijiste que te querías morir',
  'quiere morirse',
  'me rompiste la nariz',
  'me puso las manos en el cuello',
  'me aventaste el teléfono',
  // Audit round 4 misses.
  'he got drunk and hit me',
  'He got drunk and choked me',
  'He held me down and choked me',
  'He came home drunk and started hitting me',
  'He was hitting me last night',
  'He keeps hitting me',
  'My husband tried to choke me',
  'He slammed my head into the wall',
  'He got angry and pushed me down the stairs',
  'He smacked me in the face',
  'He threw me across the room',
  'He put his hands on me',
  'He said he would kill me',
  "He said he doesn't want to live anymore",
  'He said he would be better off dead',
  'Intentó ahorcarme',
  'Trató de ahorcarme',
  'Me estaba pegando',
  'Empezó a pegarme',
  'Me agarró del cuello',
  'Dice que no quiere vivir',
  'Me tiró el teléfono a la cara',
];

// First-person disclosures only the shared crisisKind() catches; the kit must catch them too.
const FIRST_PERSON = [
  "I'm going to kill myself",
  'I feel like ending my life',
  'my husband hit me again',
  'my son shoved me',
  "I'll kill myself if you make me go",
  'Me mato si me mandas a un centro',
  'Prefiero morirme antes que ir a rehabilitación',
];

// Ordinary words that must never lock the kit (audit round 3 false positives).
const SAFE = [
  'He hit me up for money again',
  'you hit my car in the driveway',
  'He grabbed my keys and drove off',
  'My son hit me up for money',
  // Audit round 4 false positives.
  'He hit me up again for money',
  'my son hit me up asking for $200',
  'He hit me up at 2am',
  'He hit me with the same excuse',
  'He pushed me into paying his rent',
  'He kicked me out of his apartment',
  'He tried to cut himself off from everyone',
  "I said you're going to kill yourself if you keep drinking",
  "The doctor said he'll kill himself if he keeps drinking",
  'He beat me to the punch',
  'Me pegó un susto',
  'Me pegó la gripe',
  'Me tiró la puerta en la cara',
  'Me tiró la comida',
  'you pushed me away',
  'you bit my head off',
  'It would kill me to lose you',
  'This is going to kill us',
  "You're going to kill yourself drinking like this",
  "I'm afraid you'll hurt yourself",
  'Me amenazó con irse de la casa',
  'he threatened to leave',
  'you threatened me with divorce',
  'you beat me at cards',
  'you pushed me to get help',
  'me empujaste a buscar ayuda',
  'vas a matarte bebiendo así',
  'cortó el pan con un cuchillo',
  'take your life back',
  'he grabbed my hand',
  'amenazó con quitarme a los niños',
  "you've seemed so tired after work",
  "you're killing yourself with this drinking",
  'you hurt my feelings when you lied',
  'te he visto muy cansado después del trabajo',
  "I'll drive you and wait for you",
  '',
];

test('the app and invitation-coach crisis patterns are the same code', () => {
  const body = (path: string) => {
    const source = readFileSync(path, 'utf8');
    return source.slice(source.indexOf('const L = '));
  };
  assert.equal(body('src/lib/invitationCrisis.ts'), body('supabase/functions/_shared/invitation-crisis.ts'));
  const screen = (path: string) => {
    const source = readFileSync(path, 'utf8');
    return source.slice(source.indexOf('export const SCREENED_FIELDS'));
  };
  assert.equal(screen('src/lib/invitationScreen.ts'), screen('supabase/functions/_shared/invitation-screen.ts'));
});

test('the app carries a verbatim copy of the shared first-person crisis check', () => {
  const block = (path: string, end: string) => {
    const source = readFileSync(path, 'utf8');
    return source.slice(source.indexOf('\nconst CLAUSE_END'), source.indexOf(end) === -1 ? undefined : source.indexOf(end)).trim();
  };
  assert.equal(
    block('src/lib/invitationUserCrisis.ts', '\0'),
    block('supabase/functions/_shared/rehearsal-safety.ts', '// ---------------- Moderation'),
    'rehearsal-safety.ts changed: copy its crisis block into src/lib/invitationUserCrisis.ts again',
  );
  for (const text of [...FIRST_PERSON, ...CRISIS, ...SAFE]) {
    assert.equal(clientCrisisKind(text), serverCrisisKind(text), text);
  }
});

test('violence, threats, weapons and self-harm in what she typed are caught (EN + ES)', () => {
  for (const text of CRISIS) {
    assert.equal(client.invitationTextInCrisis(text), true, text);
    assert.equal(server.invitationTextInCrisis(text), true, text);
  }
  for (const text of FIRST_PERSON) assert.equal(invitationInCrisis(text), true, `kit combined check: ${text}`);
});

test('everyday words never lock the kit (audit round 3 false positives)', () => {
  for (const text of SAFE) {
    assert.equal(client.invitationTextInCrisis(text), false, text);
    assert.equal(server.invitationTextInCrisis(text), false, text);
    assert.equal(invitationInCrisis(text), false, `combined: ${text}`);
  }
});

test('every free-text field is screened, and the first one that trips is named', () => {
  const serverCheck = (text: string) => server.invitationTextInCrisis(text) || userInCrisis(text);
  const cases: Array<[clientScreen.ScreenInput, clientScreen.ScreenedField | null]> = [
    [{ observation: 'you seemed tired' }, null],
    [{ usual_phrases: ["I'd rather be dead than go to rehab"] }, 'usual_phrases'],
    [{ usual_phrases: ["I'll kill myself if you make me go"] }, 'usual_phrases'],
    [{ costs_they_feel: ['my son shoved me'] }, 'costs_they_feel'],
    [{ what_use_gives: ['he said he wants to die'] }, 'what_use_gives'],
    [{ sober_moments: ['before he put a gun to his head'] }, 'sober_moments'],
    [{ use_triggers: ['after he threatened to kill me'] }, 'use_triggers'],
    [{ next_step: 'he pulled a knife on me' }, 'next_step'],
    [{ recent_incidents: ['he choked me'], observation: 'you hit me' }, 'observation'],
    [{ recent_incidents: ['fine', 'me pegó'] }, 'recent_incidents'],
  ];
  for (const [input, field] of cases) {
    assert.equal(kitCrisisField(input), field, JSON.stringify(input));
    assert.equal(serverScreen.screenInvitationFields(input, serverCheck), field, `server ${JSON.stringify(input)}`);
  }
  for (const field of Object.keys(clientScreen.FIELD_SETUP_STEP)) {
    assert.ok((clientScreen.SCREENED_FIELDS as readonly string[]).includes(field));
  }
});

test('the willingness-window safety gate fails closed', () => {
  assert.equal(safetyGateFrom({ status: 'loading', safetyConcern: null }), 'loading');
  assert.equal(safetyGateFrom({ status: 'error', safetyConcern: null }), 'unknown');
  assert.equal(safetyGateFrom({ status: 'ready', safetyConcern: 'serious' }), 'safety_first');
  assert.equal(safetyGateFrom({ status: 'ready', safetyConcern: 'some' }), 'clear');
  assert.equal(safetyGateFrom({ status: 'ready', safetyConcern: '' }), 'clear');
  assert.deepEqual(['loading', 'unknown', 'safety_first', 'clear'].map((gate) => windowInviteAllowed(gate as never)), [false, false, false, true]);
});

test('"I\u2019m safe right now" is keyed to the texts that tripped, not to every keystroke (audit round 5)', () => {
  const base = { recent_incidents: ['He choked me last month'], usual_phrases: ['Leave me alone'] };
  const key = kitCrisisKey({ ...base, observation: '' });
  assert.ok(key);
  // Typing a harmless observation keeps the acknowledgement.
  assert.equal(kitCrisisKey({ ...base, observation: 'you seemed' }), key);
  assert.equal(kitCrisisKey({ ...base, observation: "you've seemed so tired after work" }), key);
  // A new hit — in the observation or the map — is a new key: the panel comes back.
  assert.notEqual(kitCrisisKey({ ...base, observation: 'you hit me' }), key);
  assert.notEqual(kitCrisisKey({ ...base, recent_incidents: ['He choked me last month', 'he pinned me down'] }), key);
  // Order of the map items doesn't matter; no hit means no key.
  assert.equal(
    kitCrisisKey({ recent_incidents: ['b fine', 'he hit me'], usual_phrases: ['he choked me'] }),
    kitCrisisKey({ usual_phrases: ['he choked me'], recent_incidents: ['he hit me', 'b fine'] }),
  );
  assert.equal(kitCrisisKey({ observation: 'you seemed tired', usual_phrases: ['Leave me alone'] }), null);
});

test('audit round 5 phrasings are caught; everyday words still pass', () => {
  for (const text of [
    "Says he'll kill himself if we make him go to rehab", 'Said he would kill himself', "Says she'll kill herself",
    "Said he'd kill me", 'He talks about killing himself when he drinks', 'He keeps talking about killing himself',
    'He wants to kill himself', 'He wanted to kill himself last night', 'I noticed you wanted to kill yourself last night',
    'He gets violent with me when he drinks', 'He was violent with me', 'He got physical with me',
    'He sexually assaulted me', 'He pinned me down last night', 'He beat me to the ground', 'He threw me off the porch',
    'He pushed me away so hard I fell', "he's going to kill me", 'He held me down',
    'Quiere matarse', 'quería matarse', 'Me agredió', 'Fue violento conmigo', 'Me golpea', 'Habla de matarse',
  ]) {
    assert.equal(client.invitationTextInCrisis(text), true, text);
    assert.equal(server.invitationTextInCrisis(text), true, text);
  }
  for (const text of [
    'He talks about his job', 'He gets angry with me', 'He grabbed me a coffee', 'He hit me with the bill',
    'he dragged me into this mess', 'he attacked me verbally', 'he pulled my leg', 'He threw me a curveball',
    'Me pega mucho el sol', "I said you're going to kill yourself if you keep drinking",
  ]) {
    assert.equal(client.invitationTextInCrisis(text), false, text);
    assert.equal(server.invitationTextInCrisis(text), false, text);
  }
});

test('moderation hits are acknowledgeable like pattern hits, for this hit only (audit round 6)', () => {
  const clean = { observation: 'you seemed tired', next_step: 'Program X', usual_phrases: ['Leave me alone'] };
  // Nothing hit → nothing to acknowledge, nothing sent.
  assert.deepEqual(kitCrisisState(clean, null, null), { field: null, key: null, acknowledged: false });
  // The server's moderation flagged the observation → panel, with a key for this response.
  const hit = { field: 'observation' as const, source: 'moderation' as const, id: 1 };
  const shown = kitCrisisState(clean, hit, null);
  assert.equal(shown.field, 'observation');
  assert.equal(shown.acknowledged, false);
  assert.ok(shown.key);
  // "I'm safe right now" → lines come back and Personalize sends acknowledgedCrisis.
  const after = kitCrisisState(clean, hit, shown.key);
  assert.deepEqual(after, { field: null, key: shown.key, acknowledged: true });
  // A new server response is a new hit: the panel returns.
  const again = kitCrisisState(clean, { ...hit, id: 2 }, shown.key);
  assert.equal(again.field, 'observation');
  assert.equal(again.acknowledged, false);
  // Server pattern hits behave the same.
  const patterns = { field: 'unknown' as const, source: 'patterns' as const, id: 3 };
  const patternKey = kitCrisisState(clean, patterns, null).key;
  assert.equal(kitCrisisState(clean, patterns, patternKey).acknowledged, true);
  // A new local hit on top of an acknowledged server hit changes the key → panel again.
  const local = kitCrisisState({ ...clean, observation: 'he hit me' }, hit, shown.key);
  assert.equal(local.field, 'observation');
  assert.equal(local.acknowledged, false);
  // Local pattern hits keep working as before (keyed to the tripping texts).
  const tripping = { ...clean, recent_incidents: ['He choked me last month'] };
  const localKey = kitCrisisState(tripping, null, null).key;
  assert.equal(kitCrisisState(tripping, null, null).field, 'recent_incidents');
  assert.equal(kitCrisisState({ ...tripping, observation: 'you seemed so tired' }, null, localKey).acknowledged, true);
});

test('editing the observation clears a server hit there, from either screen (audit round 6)', () => {
  for (const source of ['patterns', 'moderation'] as const) {
    assert.equal(afterObservationEdit({ field: 'observation', source, id: 1 }), null, source);
    const elsewhere = { field: 'recent_incidents' as const, source, id: 1 };
    assert.equal(afterObservationEdit(elsewhere), elsewhere, `${source}: other fields stay`);
  }
  assert.equal(afterObservationEdit(null), null);
});
