import {
  fieldsToScreen,
  flaggedModerationIndex,
  invitationCrisisGate,
  moderateInvitationText,
  moderateInvitationTexts,
  moderationResultFlags,
  propertyOnlyViolence,
} from './invitation-moderation.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const result = (categories: Record<string, boolean>, scores: Record<string, number> = {}) => ({
  categories,
  category_scores: scores,
});

Deno.test('self-harm intent/instructions flag; a bare depiction needs some intent', () => {
  assert(moderationResultFlags(result({ 'self-harm/intent': true }), 'he wants out'), 'intent');
  assert(moderationResultFlags(result({ 'self-harm/instructions': true }), 'x'), 'instructions');
  assert(!moderationResultFlags(result({ 'self-harm': true }, { 'self-harm/intent': 0.05 }), 'his past overdose'), 'depiction alone');
  assert(moderationResultFlags(result({ 'self-harm': true }, { 'self-harm/intent': 0.4 }), 'x'), 'depiction with intent');
});

Deno.test('a violence verdict is judged against its own text, never another field', () => {
  assert(moderationResultFlags(result({ violence: true }), 'he grabbed me by the throat'), 'toward her');
  assert(moderationResultFlags(result({ 'harassment/threatening': true }), 'me dijo que me iba a matar'), 'ES threat');
  assert(!moderationResultFlags(result({ violence: true }), 'he punched a wall'), 'not toward her');
  assert(flaggedModerationIndex({ results: 'nope' }, ['me']) === -1, 'junk');
  // results[i] is judged against texts[i] — never "violence" from one field
  // plus "me" from another.
  assert(flaggedModerationIndex({ results: [result({ violence: true }), result({})] }, ['He punched a hole in the wall', 'Leave me alone']) === -1, 'per text');
  assert(flaggedModerationIndex({ results: [result({}), result({ 'self-harm/intent': true })] }, ['fine', 'x']) === 1, 'index of the hit');
});

Deno.test('a violence verdict is a hit unless the text is clearly property-only (audit round 7)', () => {
  const violence = result({ violence: true });
  const threatening = result({ 'harassment/threatening': true });
  const hits = [
    // Plain assaults no verb list would ever finish.
    'He burned me with a cigarette',
    'He knocked me down last night',
    'He tried to run me over',
    'He smothered me with a pillow',
    'He gave me a black eye',
    'He tied me up',
    'He said he would burn the house down with me in it',
    'Me tiró un plato anoche',
    'Me puso un cuchillo en el cuello',
    'Me tiró al suelo',
    'Me trató de atropellar',
    'Me quemó con un cigarro',
    'Me dejó un ojo morado',
    'Me arañó la cara',
    // Still hits.
    'He hit me',
    'me pegó',
    'He punched the wall next to my head',
    'He screamed in my face and threw his phone at the wall',
    'He smashed the TV and then shoved me',
    'He threw a plate at the wall in front of the kids',
    'Mi hijo rompió la puerta y luego me empujó',
    'He kicked the door and hit my daughter',
    // Not property-only, so a hit — fine, she can say she's safe.
    'My husband got into a fight at the bar',
  ];
  for (const text of hits) {
    assert(moderationResultFlags(violence, text), `violence → hit: ${text}`);
    assert(moderationResultFlags(threatening, text), `threatening → hit: ${text}`);
  }
  const propertyOnly = [
    'My son punched a hole in the wall',
    'Mi hijo le dio un puñetazo a la pared',
    'He punched a hole in the bedroom wall',
    'He threw his phone at the wall',
    'Last night my son kicked the car door',
    'Anoche mi esposo rompió la ventana',
    'Our son smashed the TV',
  ];
  for (const text of propertyOnly) {
    assert(propertyOnlyViolence(text), `property-only: ${text}`);
    assert(!moderationResultFlags(violence, text), `property-only → no hit: ${text}`);
  }
  // No violence verdict → no hit, whatever the words.
  assert(!moderationResultFlags(result({}), 'He hit me'), 'no verdict');
});

Deno.test("the audit case: a wall-punching incident plus 'Leave me alone' is not violence toward her", async () => {
  // Same order as invitation-coach: observation, next step, incidents, usual phrases…
  const texts = ['', '', 'He punched a hole in the bedroom wall', 'Leave me alone'];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    const inputs = JSON.parse(String(init.body)).input as string[];
    // Violence on the incident (item 3 of the original list) only.
    const results = inputs.map((text) => result(text.includes('punched') ? { violence: true } : {}));
    return new Response(JSON.stringify({ results }), { status: 200 });
  };
  assert(!(await moderateInvitationText(texts, 'key', fetchImpl)), 'not a crisis');
  // A real threat toward her is flagged, and its original index comes back.
  const threat = ['', 'Program X', 'He said he would break my neck'];
  const threatFetch = async (_url: string, init: RequestInit) => {
    const inputs = JSON.parse(String(init.body)).input as string[];
    return new Response(JSON.stringify({ results: inputs.map((text) => result(text.includes('neck') ? { violence: true } : {})) }), { status: 200 });
  };
  assert((await moderateInvitationTexts(threat, 'key', threatFetch)) === 2, 'index into the original list');
});

Deno.test('one bounded call with one input per text; fails open on errors, no key or timeouts', async () => {
  let calls = 0;
  let inputs: string[] = [];
  const ok = (flag: boolean) => async (_url: string, init: RequestInit) => {
    calls += 1;
    inputs = JSON.parse(String(init.body)).input;
    return new Response(JSON.stringify({ results: inputs.map(() => result(flag ? { violence: true } : {})) }), { status: 200 });
  };
  assert(await moderateInvitationText(['he hit me', 'x'.repeat(9000)], 'key', ok(true)), 'flag');
  assert(calls === 1, 'one call for every field');
  assert(Array.isArray(inputs) && inputs.length === 2, 'one input per text');
  assert(inputs.join('').length <= 8000, 'bounded input');
  assert(!(await moderateInvitationText(['he hit me'], undefined, ok(true))), 'no key: fail open');
  assert(!(await moderateInvitationText(['  '], 'key', ok(true))), 'nothing to screen');
  const broken = async () => new Response('down', { status: 500 });
  assert(!(await moderateInvitationText(['he hit me'], 'key', broken)), 'HTTP error: fail open');
  const throwing = async () => { throw new Error('network'); };
  assert(!(await moderateInvitationText(['he hit me'], 'key', throwing)), 'network: fail open');
  const slow = (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
  assert(!(await moderateInvitationText(['he hit me'], 'key', slow, 20)), 'timeout: fail open');
});

Deno.test('crisis gate: patterns, then moderation, over the fields to screen', async () => {
  const texts = [
    { field: 'observation', text: 'He said he would break my neck' },
    { field: 'next_step', text: 'Program X' },
  ] as const;
  const all = ['observation', 'next_step'] as const;
  let calls = 0;
  const flagsNeck = async (input: readonly string[]) => {
    calls += 1;
    return input.findIndex((text) => text.includes('neck'));
  };
  // A pattern hit wins before any moderation call.
  assert(
    JSON.stringify(await invitationCrisisGate({ screen: all, texts, patternField: () => 'next_step', moderate: flagsNeck }))
      === JSON.stringify({ field: 'next_step', source: 'patterns' }),
    'pattern hit',
  );
  assert(calls === 0, 'no moderation call after a pattern hit');
  // No pattern hit: moderation flags the observation → 409 names it.
  const first = await invitationCrisisGate({ screen: all, texts, patternField: () => null, moderate: flagsNeck });
  assert(JSON.stringify(first) === JSON.stringify({ field: 'observation', source: 'moderation' }), 'moderation hit');
  assert(calls === 1, 'one moderation call');
  // Nothing to screen (acknowledged, nothing typed since) → no 409, no call.
  assert((await invitationCrisisGate({ screen: [], texts, patternField: () => 'observation', moderate: flagsNeck })) === null, 'nothing to screen');
  assert(calls === 1, 'no call when nothing is screened');
  // Only the fields to screen reach the patterns and moderation.
  let seen: readonly string[] = [];
  await invitationCrisisGate({ screen: ['next_step'], texts, patternField: () => null, moderate: async (input) => { seen = input; return -1; } });
  assert(JSON.stringify(seen) === JSON.stringify(['Program X']), 'scoped texts');
  assert((await invitationCrisisGate({ screen: all, texts, patternField: () => null, moderate: async () => 7 })) === null, 'out of range');
});

Deno.test('"I\'m safe right now" covers the hits she saw, never words typed afterwards (audit round 7)', async () => {
  const FIELDS = ['observation', 'next_step', 'recent_incidents', 'usual_phrases'] as const;
  type Field = typeof FIELDS[number];
  const map = { recent_incidents: ['He shoved me into the counter yesterday'], usual_phrases: ['Leave me alone'] };
  // Moderation: violence wherever the words are violent toward her.
  const moderationFetch = async (_url: string, init: RequestInit) => {
    const inputs = JSON.parse(String(init.body)).input as string[];
    const results = inputs.map((text) => result(/shoved me|slapped|run me over/i.test(text) ? { violence: true } : {}));
    return new Response(JSON.stringify({ results }), { status: 200 });
  };
  const patterns = (text: string) => /shoved me/i.test(text);
  const coach = (request: { observation: string; nextStep: string; acknowledged: boolean; ackObservation: string; ackNextStep: string }) => {
    const values: Record<Field, string | string[]> = { observation: request.observation, next_step: request.nextStep, ...map };
    const screen = fieldsToScreen(FIELDS, request.acknowledged, [
      { field: 'observation', current: request.observation, acknowledgedText: request.ackObservation },
      { field: 'next_step', current: request.nextStep, acknowledgedText: request.ackNextStep },
    ]);
    return invitationCrisisGate<Field>({
      screen,
      texts: FIELDS.flatMap((field) => {
        const value = values[field];
        return (typeof value === 'string' ? [value] : value).filter((text) => text.trim()).map((text) => ({ field, text }));
      }),
      patternField: (fields) => fields.find((field) => {
        const value = values[field];
        return (typeof value === 'string' ? [value] : value).some(patterns);
      }) ?? null,
      moderate: (input) => moderateInvitationTexts(input, 'key', moderationFetch),
    });
  };
  // 1) The incident trips the screen; she sees the resources.
  const before = await coach({ observation: '', nextStep: 'Program X', acknowledged: false, ackObservation: '', ackNextStep: '' });
  assert(before?.field === 'recent_incidents', 'incident hit');
  // 2) She taps "I'm safe right now" with an empty observation: the map hit is set aside.
  const after = await coach({ observation: '', nextStep: 'Program X', acknowledged: true, ackObservation: '', ackNextStep: 'Program X' });
  assert(after === null, 'acknowledged incident → lines');
  // 3) Then she types an observation only moderation catches → 409 on the observation.
  const typed = await coach({
    observation: 'He slapped my daughter last night', nextStep: 'Program X', acknowledged: true, ackObservation: '', ackNextStep: 'Program X',
  });
  assert(JSON.stringify(typed) === JSON.stringify({ field: 'observation', source: 'moderation' }), 'new observation screened');
  // 4) She acknowledges that one too (same observation on screen) → lines.
  const again = await coach({
    observation: 'He slapped my daughter last night', nextStep: 'Program X', acknowledged: true,
    ackObservation: 'He slapped my daughter last night', ackNextStep: 'Program X',
  });
  assert(again === null, 'an unchanged, acknowledged observation stays acknowledged');
  // 5) A changed next step is screened the same way.
  const step = await coach({
    observation: '', nextStep: 'He tried to run me over', acknowledged: true, ackObservation: '', ackNextStep: 'Program X',
  });
  assert(step?.field === 'next_step', 'changed next step screened');
  // Without the acknowledgement, everything is screened.
  assert(JSON.stringify(fieldsToScreen(FIELDS, false, [])) === JSON.stringify(FIELDS), 'all fields');
  assert(fieldsToScreen(FIELDS, true, [{ field: 'observation', current: ' same ', acknowledgedText: 'same' }]).length === 0, 'whitespace only is unchanged');
});
