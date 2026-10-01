import {
  breakTextFor,
  hasBreakToken,
  containsSlur,
  crisisKind,
  debriefGate,
  harmFilteredSentences,
  moderationIndicatesCrisis,
  spokenBeyond,
  MAX_SCREEN_CHARS,
  mentionsHarm,
  normalizeDebrief,
  partnerReplyUnsafe,
  replyGate,
  resolveWorkOnTurn,
  userInCrisis,
} from './rehearsal-safety.ts';

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
    "He's hitting me right now",
  ]) assert(userInCrisis(text), text);
});

Deno.test('first-person crisis disclosures break character (ES)', () => {
  for (const text of [
    'A veces quiero matarme.',
    'No quiero vivir más.',
    'no quiero estar aquí',
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
    workOnTurns: [null, null],
    drill: '',
    scores: { love: 5, ask: 1, boundaries: 3, calm: 3 },
  });
  assertEquals(normalizeDebrief({ wentWell: [], workOn: [] }), null);
  assertEquals(normalizeDebrief('not json'), null);
});

const USER_TURNS = [
  "Hey, I love you and I'm worried about you.",
  "I can't keep covering for you with your boss.",
  'Will you talk to someone this week?',
];

Deno.test('workOn objects keep text in workOn and pin the quoted user turn', () => {
  const d = normalizeDebrief({
    wentWell: ['You opened with "I love you and I\'m worried" — warm.'],
    workOn: [
      { text: 'When you said "I can\'t keep covering for you" it handed the boundary away — try "I won\'t keep covering for you."', turn: 2 },
      { text: 'Not a quote, just advice.', turn: 3 },
    ],
    drill: 'x',
    scores: { love: 4, ask: 3, boundaries: 2, calm: 4 },
  }, USER_TURNS);
  assertEquals(d?.workOn.length, 2);
  assertEquals(typeof d?.workOn[0], 'string');
  assertEquals(d?.workOnTurns, [1, 2]);
});

Deno.test('the verbatim quote outranks a wrong model turn number', () => {
  assertEquals(resolveWorkOnTurn('You said “Will you talk to someone” — good, but…', 1, USER_TURNS), 2);
  // An elided quote still matches the turn it came from.
  assertEquals(resolveWorkOnTurn('"Hey, I love you… worried about you" was warm', 3, USER_TURNS), 0);
});

Deno.test('turn numbers are validated and clamped to the transcript', () => {
  assertEquals(resolveWorkOnTurn('no quote', 99, USER_TURNS), 2);
  assertEquals(resolveWorkOnTurn('no quote', 0, USER_TURNS), 0);
  assertEquals(resolveWorkOnTurn('no quote', '2', USER_TURNS), 1);
  assertEquals(resolveWorkOnTurn('no quote', 'later', USER_TURNS), null);
  assertEquals(resolveWorkOnTurn('no quote', undefined, USER_TURNS), null);
  // Without the transcript nothing can be validated.
  assertEquals(resolveWorkOnTurn('"I can\'t keep covering"', 2, []), null);
});

Deno.test('legacy string workOn items still normalize, now with turns resolved from quotes', () => {
  const d = normalizeDebrief({
    wentWell: ['ok'],
    workOn: ['"Will you talk to someone this week" was a clear ask — hold it.'],
    scores: {},
  }, USER_TURNS);
  assertEquals(d?.workOnTurns, [2]);
  assertEquals(d?.scores, { love: 3, ask: 3, boundaries: 3, calm: 3 });
});

Deno.test('"I\'m going to die" alone is left to moderation and the model (high-precision patterns)', () => {
  for (const text of ["I'm going to die if this keeps up", 'I’m gonna die', 'i am gonna die', 'Voy a morir si esto sigue', "I'm not going to die, relax."]) {
    assert(!userInCrisis(text), text);
  }
  // Explicit intent still breaks.
  for (const text of ["I'm going to end my life", 'I want to die.', 'I just want to end my life']) assert(userInCrisis(text), text);
});

Deno.test('crisis screening sees the end of a long spoken turn (not just the first 600 chars)', () => {
  const long = `${'I keep thinking about the holidays and how it used to be. '.repeat(30)}Honestly I want to kill myself.`;
  assert(long.length > 1500, 'fixture is long');
  assert(userInCrisis(long), 'late disclosure missed');
  // Bounded: text past MAX_SCREEN_CHARS is not scanned (keeps cost predictable).
  assert(!userInCrisis(`${'x'.repeat(MAX_SCREEN_CHARS)} I want to kill myself`), 'unbounded scan');
});

Deno.test('reply gate: a crisis always wins over warm-up complete', () => {
  assertEquals(replyGate({ incomingOpening: false, lastUserRaw: 'I want to die', screeningText: undefined, warmupOver: true }), 'crisis');
  assertEquals(replyGate({ incomingOpening: false, lastUserRaw: 'Hi', screeningText: undefined, warmupOver: true }), 'warmup_complete');
  assertEquals(replyGate({ incomingOpening: false, lastUserRaw: 'Hi', screeningText: undefined, warmupOver: false }), 'ok');
  // A letter read aloud: the spoken transcript is screened even though the letter text is what gets sent.
  assertEquals(
    replyGate({ incomingOpening: false, lastUserRaw: 'Dear Jake, I love you.', screeningText: 'Dear Jake... I just want to end my life', warmupOver: false }),
    'crisis',
  );
  assertEquals(replyGate({ incomingOpening: true, lastUserRaw: undefined, screeningText: undefined, warmupOver: false }), 'ok');
});

Deno.test('debrief gate: a transcript with any crisis disclosure is never coached', () => {
  assertEquals(debriefGate(['I love you.', 'No quiero vivir más.', 'Ok.']), 'safety_break');
  assertEquals(debriefGate(['I love you.', "I don't want to live like this anymore — please get help."]), 'ok');
});

Deno.test('output guard: the character never threatens self-harm, suicide, or violence', () => {
  for (const line of [
    "If you send me away I'll kill myself.",
    'Maybe I should just disappear.',
    "You'd all be better off without me.",
    "I swear I'll hurt you if you call them.",
    "I'm gonna kill him.",
    'Te voy a matar.',
    'Mejor desaparezco y ya.',
    'I want to die.',
  ]) assert(partnerReplyUnsafe(line), line);
  for (const line of [
    "I'm going to hit the road.",
    "I'm not gonna die, Mom, relax.",
    "I'll never hurt you, you know that.",
    "You're killing me with this.",
    "I'm done. Have a nice life.",
    'Are you KIDDING me right now?',
  ]) assert(!partnerReplyUnsafe(line), line);
});

Deno.test('harm filter catches family notes that quote threats', () => {
  for (const text of [
    "If you send me to rehab I'll kill myself",
    'He said he would end it all',
    'Threatened to hurt me',
    'punched the wall',
    'tiene una pistola',
    'dijo que se va a matar',
  ]) assert(mentionsHarm(text), text);
  for (const text of ["I've got it under control", 'Missed Thanksgiving', 'Lost his license', 'Friday nights with Dan']) {
    assert(!mentionsHarm(text), text);
  }
});

Deno.test('audit phrasings break character (EN)', () => {
  for (const text of [
    'I wanna die',
    'I just want to die.',
    'I really want to die',
    "I've been thinking about suicide",
    'I have suicidal thoughts',
    'I wish I was dead',
    'I wish I were dead.',
    'Everyone would be better off without me.',
    "I'd be better off dead",
    "I'm going to take my own life",
    'He hits me.',
    'She beats me when she drinks',
    'My husband hits me',
    'I just want to end it all',
    "I keep thinking about killing myself",
  ]) assert(userInCrisis(text), text);
});

Deno.test('audit phrasings break character (ES)', () => {
  for (const text of [
    'Me quiero matar',
    'me voy a matar',
    'Me quiero suicidar.',
    'me voy a suicidar',
    'Quisiera morirme',
    'Me estoy cortando',
    'Me quiero hacer daño',
    'Mi esposo me pega',
    'Ojalá me muriera',
    'Un día de estos me mato.',
    'Tengo pensamientos suicidas',
    'Prefiero morirme',
  ]) assert(userInCrisis(text), text);
});

Deno.test('negations, figures of speech, and rehearsal lines stay in the practice', () => {
  for (const text of [
    "I'm not going to die, relax.",
    "I don't want to die.",
    'I would never kill myself.',
    "I'm not going to hurt myself, I promise.",
    "I'm going to die of embarrassment",
    'Me voy a morir de vergüenza',
    'Me mato trabajando para pagar tus cuentas.',
    'Me estoy cortando el pelo',
    "He's hitting the bottle again.",
    'You hit me last year and I was terrified.',
    'When you overdosed I thought you would die.',
    "I don't want to live like this anymore — please get help.",
  ]) assert(!userInCrisis(text), text);
});

Deno.test('moderation verdict: intent or instructions count; a bare depiction needs an intent signal', () => {
  assert(moderationIndicatesCrisis({ results: [{ categories: { 'self-harm/intent': true } }] }), 'intent');
  assert(moderationIndicatesCrisis({ results: [{ categories: { 'self-harm/instructions': true } }] }), 'instructions');
  assert(
    moderationIndicatesCrisis({ results: [{ categories: { 'self-harm': true }, category_scores: { 'self-harm/intent': 0.4 } }] }),
    'self-harm with intent signal',
  );
  assert(
    !moderationIndicatesCrisis({ results: [{ categories: { 'self-harm': true }, category_scores: { 'self-harm/intent': 0.01 } }] }),
    'talking about a loved one’s overdose',
  );
  assert(!moderationIndicatesCrisis({ results: [{ categories: { violence: true } }] }), 'violence alone');
  assert(!moderationIndicatesCrisis(null), 'null');
  assert(!moderationIndicatesCrisis({ error: 'x' }), 'error body');
});

Deno.test('what was said beyond the letter is what gets screened', () => {
  const letter = 'Jake, I love you. When you said you wanted to die, I could not sleep. Will you go to treatment today?';
  const reading = 'Jake I love you. When you said you wanted to die I could not sleep. Will you go to treatment today?';
  assertEquals(spokenBeyond(reading, letter), '');
  const added = 'Jake I love you. Honestly I want to kill myself. When you said you wanted to die I could not sleep.';
  assertEquals(spokenBeyond(added, letter), 'Honestly I want to kill myself.');
  // Word by word: a short "No." is never "inside" a longer word.
  assertEquals(spokenBeyond('No.', 'I know you said no'), 'No.');
});

Deno.test('slurs and sexual insults are caught; ordinary heated swearing is not', () => {
  for (const text of ["You're a stupid bitch", 'eres una puta', 'shut up, you fag', 'maricón']) {
    assert(containsSlur(text) && partnerReplyUnsafe(text), text);
  }
  for (const text of ["You're such an asshole", 'Damn it, Mom', 'Hypocrite!', 'This is bullshit', 'Vete al diablo']) {
    assert(!containsSlur(text) && !partnerReplyUnsafe(text), text);
  }
});

Deno.test('audit character lines are guarded', () => {
  for (const line of [
    "I'd rather die than go to rehab.",
    "I'd rather be dead.",
    'I wanted to die that night.',
    'I wish I was dead.',
    'Maybe I should just take my own life.',
    "I'll drink myself to death, happy?",
    'Me voy a matar.',
    'Un día de estos me mato.',
    'Prefiero morirme.',
    "I'll break your neck.",
    "I'll smash your face in.",
    'Te voy a romper la cara.',
  ]) assert(partnerReplyUnsafe(line), line);
});

Deno.test('harm filter keeps a normal letter and drops only harmful sentences', () => {
  const letter = 'Jake, I love you.\nWhen you crashed the car I felt terrified. You said you would kill yourself if we called anyone. Will you go today?';
  assertEquals(harmFilteredSentences(letter), 'Jake, I love you. When you crashed the car I felt terrified. Will you go today?');
  const normal = 'Mom, I love you. I remember our trips to the lake. Will you accept help today?';
  assertEquals(harmFilteredSentences(normal), normal);
});

Deno.test("contraction negations are reassurance, not disclosures (won't / can't keep / didn't)", () => {
  for (const text of [
    "I won't hurt myself.",
    "I won't keep hurting myself by covering for you.",
    "I can't keep killing myself to hold this family together.",
    "I can't keep hurting myself like this.",
    "I don't want to kill myself, I just want you to get help.",
    "I don't wanna kill myself working two jobs to pay your rent.",
    "I'm done hurting myself to protect you.",
    "I didn't hurt myself, I'm fine.",
    'No voy a matarme, tranquila.',
    'No me quiero matar, quiero que te ayudes.',
    'Jamás me voy a hacer daño.',
  ]) assert(!userInCrisis(text), text);
  assert(!partnerReplyUnsafe("I didn't hurt myself, I'm fine."), 'in-character denial');
  for (const text of [
    'I want to kill myself',
    "I can't stop thinking about killing myself",
    "I don't care if I kill myself",
    "I can't stop hurting myself",
    "I can't promise I won't hurt myself tonight",
    "I'm not sure I won't kill myself",
    'Me quiero matar',
  ]) assert(userInCrisis(text), text);
});

Deno.test('"live / be here anymore" also counts when the sentence goes on', () => {
  for (const text of [
    "I don't want to live anymore and I have the pills ready",
    "I don't want to be alive anymore but I can't tell anyone",
    'No quiero vivir más y tengo las pastillas',
    'I wish I could go to sleep and not wake up',
    "I wouldn't mind if I didn't wake up",
    "I don't want to wake up tomorrow",
    "I've thought about taking all my pills",
    'I took all my pills an hour ago',
    'Sometimes I think about suicide',
    "I can't do this anymore, I'm done with life",
  ]) assertEquals(crisisKind(text), 'self_harm');
  for (const text of [
    "I don't want to live like this anymore — please get help.",
    "One night you'll go to sleep and never wake up.",
    "I've been thinking about ending it with you if you don't get help.",
    "Honestly I've been thinking about ending it",
    "I'm going to die of worry",
    "I'm going to die if anything happens to you",
    'Me voy a morir de preocupación',
  ]) assertEquals(crisisKind(text), null);
});

Deno.test('abuse she is suffering (third person, present or past) gets the abuse path', () => {
  for (const text of [
    'my husband hit me again',
    'he beat me last night',
    'he choked me last night',
    "he's been hitting me",
    'he hits me',
    "I'm scared he'll kill me",
    'Mi esposo me pegó anoche',
    'Me golpeó otra vez',
  ]) assertEquals(crisisKind(text), 'abuse');
  // A letter line to the loved one is second person and never breaks the session.
  for (const text of ['When you hit me last year, I was terrified.', 'Cuando me pegaste, tuve miedo.', 'You beat me down with your words.']) {
    assertEquals(crisisKind(text), null);
  }
  assertEquals(replyGate({ incomingOpening: false, lastUserRaw: 'my husband hit me again', screeningText: undefined, warmupOver: true }), 'abuse');
  assert(breakTextFor('abuse', 'en').includes('1-800-799-7233') && breakTextFor('abuse', 'en').includes('911'), 'DV hotline');
  assert(breakTextFor('abuse', 'es').includes('88788'), 'ES hotline');
  assert(breakTextFor('self_harm', 'en').includes('988'), '988');
});

// Round 3 audit (high-precision patterns): every phrase the audit listed.
const R3_NULL = [
  "You're killing me.",
  "you're killing me with this",
  "I'm dying inside.",
  "I'm dying inside watching you",
  "This is killing our family.",
  "This is killing me.",
  "It's killing me to watch you do this.",
  "Watching you is killing me.",
  "I'd die for you.",
  "I would die for you, you know that.",
  "You hit rock bottom.",
  "You beat me to it.",
  "He hit the wall.",
  "He hit the wall last night and broke his hand.",
  "My son hit the wall.",
  "He hit me up for money again.",
  "He hit me up last week asking for cash.",
  "My son hit me up for $200.",
  "She beat me to it.",
  "He beat me to the punch.",
  "My husband beat me at cards.",
  "He beat me home.",
  "He's hurting me by using.",
  "My son is hurting me so much with his drinking.",
  "It hurts me to see you like this.",
  "You're hurting me.",
  "My daughter is hurting me and herself.",
  "He hurt me when he lied.",
  "My husband hurt me deeply when he relapsed.",
  "He's been hurting me for years with his lies.",
  "She hurts me every time she uses.",
  "I'm scared he'll hurt himself.",
  "I'm scared he's going to kill himself.",
  "I'm worried he'll kill me with worry.",
  "I'm going to die of worry.",
  "I'm going to die if you keep doing this",
  "I'm going to die if anything happens to you.",
  "I want to die when I see you like this.",
  "I just want to die of embarrassment",
  "I'm worried sick.",
  "I'm sick and tired.",
  "I don't want to live like this anymore.",
  "I don't want to live like this anymore, and I won't.",
  "I don't want to live with you anymore.",
  "I don't want to be here when you're high.",
  "I don't want to be here anymore if you keep using.",
  "I won't kill myself trying to save you.",
  "I'm not going to kill myself over this.",
  "I'm done killing myself to keep you afloat.",
  "I've been killing myself to keep this family together.",
  "I'm killing myself working two jobs to pay your bills.",
  "I've been killing myself for you.",
  "I'm tired of killing myself for you.",
  "I refuse to keep hurting myself for you.",
  "I can't keep killing myself for you.",
  "I won't keep hurting myself.",
  "You're going to kill yourself.",
  "You're going to end up dead.",
  "I'm afraid you'll die.",
  "I'm afraid I'll find you dead.",
  "Every night I'm scared I'll find you dead.",
  "I'd rather die than lose you.",
  "Me estás matando.",
  "Me muero de miedo.",
  "Me estoy muriendo por dentro.",
  "Esto está matando a nuestra familia.",
  "Daría mi vida por ti.",
  "Me pegaste cuando estabas borracho.",
  "Tocaste fondo.",
  "Me ganó.",
  "Me matas con tus mentiras.",
  "Me mata verte así.",
  "Me muero si te pasa algo.",
  "No quiero vivir así.",
  "No quiero vivir así más.",
  "My husband is killing me with his drinking.",
  "He's killing me with his drinking.",
  "She's killing me.",
  "It's like he took my life away.",
  "Addiction took my life over.",
  "You're taking my life away.",
  "You took my life savings.",
  "You ended my life as I knew it.",
  "You stole my car and took my life savings.",
  "I gave you my life.",
  "I want to end it with dignity",
  "I want to end it now, this cycle.",
  "I want to end it.",
  "I'm going to end it with him.",
  "I'm going to end it tonight — the enabling.",
  "I want to end this relationship.",
  "I'm done with everything you've put me through.",
  "I'm done with everything.",
  "I am done with this life you've created.",
  "The pills you took scared me.",
  "I found all the pills you took.",
  "I took all the pills out of the cabinet.",
  "I took all your pills and flushed them.",
  "I took all of the pills and threw them out.",
  "I've been thinking about ending it with him.",
  "I've been thinking about ending it.",
  "I keep thinking about ending this marriage.",
  "Your brother is better off without me nagging.",
  "You'd be better off without me nagging you.",
  "Maybe you'd be better off without me.",
  "I'm cutting myself off from your money.",
  "I'm cutting myself off from you.",
  "I need to stop cutting myself off from friends.",
  "I'm cutting myself some slack.",
  "I'm hurting myself by enabling you.",
  "I'm harming myself by staying.",
  "I kept hurting myself by giving you money.",
  "I'm hurting myself more than I'm helping you.",
  "I cut myself off from everyone.",
  "I kill myself every day trying to help you.",
  "Mi hijo me pegó un susto.",
  "Me pegó la gripe.",
  "Me empujó a buscar ayuda.",
  "Me empujó a tomar esta decisión.",
  "Me lastimó mucho lo que dijiste.",
  "Me golpeó la realidad.",
  "Él me lastima con sus mentiras.",
  "Me hice daño a mí misma por protegerte.",
  "Me estoy haciendo daño al darte dinero.",
  "Voy a matarme trabajando para pagar tus deudas.",
  "Me mato trabajando.",
  "Me mato trabajando por ti.",
  "Me voy a morir de la preocupación.",
  "Me quiero morir de la vergüenza.",
  "Quiero morir contigo.",
  "He's choking me with his control",
  "He hit me with the news that he relapsed.",
  "He hit me with a guilt trip.",
  "My son hit me with another excuse.",
  "She hit me with a lawsuit.",
  "He beat me down emotionally.",
  "They beat me to the hospital.",
  "He attacked me verbally.",
  "My husband attacked me for setting a boundary.",
  "She attacked me on Facebook.",
  "He's abusing me emotionally.",
  "He shoved me out of the way to get to the door.",
  "He kicked me out of the house.",
  "My son kicked me out of his apartment.",
  "My daughter shoved me aside.",
  "My husband punched me in the gut with that news.",
];
const R3_FLAG: [string, string][] = [
  ["I want to kill myself.", "self_harm"],
  ["I'm going to kill myself.", "self_harm"],
  ["I can't stop hurting myself.", "self_harm"],
  ["I can't promise I won't hurt myself.", "self_harm"],
  ["I'm not sure I won't kill myself.", "self_harm"],
  ["I want to die.", "self_harm"],
  ["I just want to die.", "self_harm"],
  ["I don't want to live anymore.", "self_harm"],
  ["I don't want to be alive.", "self_harm"],
  ["I've been thinking about killing myself.", "self_harm"],
  ["Sometimes I think about killing myself.", "self_harm"],
  ["I think about suicide every day.", "self_harm"],
  ["I'm suicidal.", "self_harm"],
  ["I took all my pills.", "self_harm"],
  ["I wish I was dead.", "self_harm"],
  ["Everyone would be better off without me.", "self_harm"],
  ["I'd be better off dead.", "self_harm"],
  ["I want to end it all.", "self_harm"],
  ["I'm going to end my life.", "self_harm"],
  ["I just want to go to sleep and not wake up.", "self_harm"],
  ["I'm done with life.", "self_harm"],
  ["I have a plan to kill myself.", "self_harm"],
  ["I've been cutting myself.", "self_harm"],
  ["I cut myself last night.", "self_harm"],
  ["I hurt myself again last night.", "self_harm"],
  ["I don't see the point in living.", "self_harm"],
  ["I don't want to wake up tomorrow.", "self_harm"],
  ["Honestly I want to die.", "self_harm"],
  ["I want to die, I can't do this anymore.", "self_harm"],
  ["I'd rather be dead.", "self_harm"],
  ["I'm thinking of killing myself.", "self_harm"],
  ["I think I'm going to kill myself tonight.", "self_harm"],
  ["I wanna kill myself.", "self_harm"],
  ["I've thought about killing myself.", "self_harm"],
  ["I'm planning to kill myself.", "self_harm"],
  ["I don't know if I won't hurt myself.", "self_harm"],
  ["I don't think I can keep myself safe.", "self_harm"],
  ["I can't keep myself safe.", "self_harm"],
  ["I can't go on anymore.", "self_harm"],
  ["I can't go on living like this.", "self_harm"],
  ["I took a whole bottle of pills.", "self_harm"],
  ["I swallowed a bottle of pills.", "self_harm"],
  ["I overdosed on purpose.", "self_harm"],
  ["I don't want to be here anymore.", "self_harm"],
  ["I can't do this anymore, I'm going to kill myself.", "self_harm"],
  ["I want to kill myself because of you.", "self_harm"],
  ["I never want to wake up again.", "self_harm"],
  ["I don't care if I live or die.", "self_harm"],
  ["I wish I could die.", "self_harm"],
  ["I'm ready to die.", "self_harm"],
  ["Quiero matarme.", "self_harm"],
  ["Me quiero morir.", "self_harm"],
  ["No quiero vivir más.", "self_harm"],
  ["He pensado en suicidarme.", "self_harm"],
  ["My husband hit me again.", "abuse"],
  ["He hit me last night.", "abuse"],
  ["My husband beat me.", "abuse"],
  ["He choked me.", "abuse"],
  ["He's hitting me.", "abuse"],
  ["My son punched me.", "abuse"],
  ["He hits me when he drinks.", "abuse"],
  ["He hit me in the face.", "abuse"],
  ["My husband is hitting me", "abuse"],
  ["He threatened to kill me.", "abuse"],
  ["My husband threatened to kill me.", "abuse"],
  ["I'm scared he's going to kill me.", "abuse"],
  ["I'm afraid my husband will kill me.", "abuse"],
  ["He put his hands around my neck.", "abuse"],
  ["He raped me.", "abuse"],
  ["He pushed me down the stairs.", "abuse"],
  ["My son pushed me.", "abuse"],
  ["He slapped me.", "abuse"],
  ["He grabbed me by the throat.", "abuse"],
  ["My husband hits me.", "abuse"],
  ["My husband hit me and I'm scared.", "abuse"],
  ["Mi esposo me pegó.", "abuse"],
  ["Mi esposo me golpea.", "abuse"],
  ["Me pegó anoche.", "abuse"],
  ["Mi hijo me amenazó con matarme.", "abuse"],
];

const R3_ES_SELF_HARM = [
  'A veces me lastimo.', 'A veces me lastimo cuando estoy sola.', 'Me lastimo para no sentir nada.', 'Me corto los brazos.',
  'Me pego un tiro.', 'Un día de estos me pego un tiro.', 'Me golpeo la cabeza contra la pared.', 'Me estoy lastimando.',
  'Me hago daño.', 'Me hago daño a veces.', 'Me corto.', 'Me he estado cortando.', 'Quiero morirme.', 'Ya no quiero vivir.',
  'No quiero seguir viviendo.', 'Estoy pensando en suicidarme.', 'Me quiero matar.', 'Tengo ganas de morirme.',
  'Me tomé todas las pastillas.', 'Me voy a tomar todas las pastillas.', 'Voy a tomarme todas las pastillas.',
  'No aguanto más, me quiero morir.', 'I hurt myself again.', 'I cut myself.', 'I took all of my pills tonight.',
];
const R3_ABUSE = [
  'Mi hijo me amenazó con matarme.', 'Mi esposo dijo que va a matarme.', 'Tengo miedo de que me mate.',
  'My husband threatened to kill me last night.', "He said he's going to kill me.", 'He grabbed me by the throat.',
  'He pushed me down the stairs.', 'He put his hands around my neck.', 'My husband choked me last night.', 'He strangled me.',
];
const R3_NULL_MORE = [
  // Spanish lines to the loved one, and figures of speech.
  'Me lastimó mucho que me mintieras.', 'Me lastimó lo que hiciste en Navidad.', 'Me lastimó verte así.',
  'Me pegó muy duro verte en el hospital.', 'Me golpeó mucho la noticia de tu arresto.', 'Me pegó un susto tremendo tu llamada.',
  'Lo que pasó me empujó a buscar ayuda para mí.', 'Me ha lastimado mucho tu silencio.', 'Me ha golpeado mucho todo esto.',
  'Me violó la confianza que te tenía.', 'Me dolió mucho.', 'Él me lastima con sus mentiras.',
  'Me voy a morir de la preocupación si sigues así.', 'Me voy a morir de la angustia.', 'Me voy a morir del susto.',
  'Me quiero morir de la vergüenza.', 'Me voy a morir de pena.', 'Me voy a morir de miedo.', 'Me muero de la preocupación.',
  'Me muero de miedo cada noche.', 'Me voy a morir algún día y quiero saber que estás bien.', 'Me voy a morir sin verte sobrio.',
  'Me voy a morir de un infarto.', 'Me voy a morir de un disgusto.',
  // English idioms, the bare "going to die", and pills taken away.
  "I've been killing myself trying to hold this family together.", "I've been killing myself for years to cover for you.",
  "I'm killing myself trying to fix this.", 'I kill myself every day worrying about you.', "I'm hurting myself by enabling you.",
  'I was hurting myself by paying your rent.', "I've been hurting myself trying to save you.", "I'm cutting myself off from your money.",
  "I took all the pills out of the house so you can't get them.", 'I took all the pills to the pharmacy drop-off.',
  'I took all the meds out of the cabinet.', 'They hit me with a five thousand dollar bill.', 'He hit me up for money again.',
  "He's hurting me with his drinking.", "I'm going to die of a heart attack worrying about you.", "I'm going to die of exhaustion.",
  "I'm going to die of a broken heart.", "I'm going to die waiting for you to call.", "I'm going to die before you get sober.",
  "I'm going to die if you relapse again.", "I'm gonna die if you keep this up.", "I'm going to die someday and you'll regret this.",
  "I'm going to die one day, and I want to know you're okay.", "I'm 68, I'm going to die eventually.",
  "I want to die when I think about what you've been through.",
];

Deno.test('round 3: unambiguous first-person disclosures break, with the right kind', () => {
  for (const [text, want] of R3_FLAG) assertEquals([text, crisisKind(text)], [text, want]);
  for (const text of R3_ES_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  for (const text of R3_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
});

Deno.test('round 3: figurative, ambiguous, and second-person lines never hard-break', () => {
  for (const text of [...R3_NULL, ...R3_NULL_MORE]) assertEquals([text, crisisKind(text)], [text, null]);
  // userInCrisis keeps its signature (other features import it).
  assertEquals(userInCrisis('Me lastimó mucho que me mintieras.'), false);
  assertEquals(userInCrisis('A veces me lastimo.'), true);
});

// Round 4 audit: unambiguous forms fire; inherently figurative ones are left to the model.
const R4_SELF_HARM = [
  'I feel suicidal', "I've been feeling suicidal", "I've been suicidal for weeks",
  "I want to die because I can't take this anymore", 'Lately I want to die every day', 'I want to die and I mean it',
  'I just want to die so this pain stops', "I've been wanting to die", 'I feel like I want to die', 'I just feel like dying',
  'I feel like killing myself', "I'm thinking of ending my life", "I'm going to take all my pills tonight",
  "I'm going to take all of my pills tonight", "I'm going to swallow all my pills", "I'm going to take a bottle of pills",
  "I'm thinking about taking all my pills", 'I want to take all my pills', "I'm going to overdose tonight", 'I have the pills ready',
  "Tonight I'm going to end it", "I have a gun and I'm going to use it on myself", "I can't go on living like this.",
  'Quiero morir.', 'Quiero suicidarme', 'He pensado en matarme', 'Me quiero morir y lo digo en serio', 'A veces quiero morir',
  'Intenté matarme el año pasado', 'Traté de matarme', 'I just hurt myself again', 'Me hago daño',
];
const R4_ABUSE = [
  'He tried to kill me', 'My husband tried to kill me', 'He tried to choke me', 'He tried to strangle me',
  "He's been hitting me for years", 'My husband has been hitting me for months', 'He hits me at night', 'He hits me on the head',
  'He beat me up', 'He beat me up again', 'My husband beat me up last night', 'My son beat me up last night', 'He beats me up when he drinks',
  'He beat the crap out of me', 'He beat me black and blue', 'He beat me so bad I went to the hospital',
  'He hit me with a belt', 'He hit me with his fist', 'My son hit me with a chair', 'He hit me on the head with a bottle',
  'He kicked me', 'He kicked me in the stomach', 'He threw me against the wall', 'My son pushed me.',
  'He threatened me with a knife', 'My husband pulled a gun on me', 'He held a knife to my throat',
  'He threatened to kill me', "He said he's going to kill me", 'He said he would kill me', "He said he'd kill me if I left",
  "He has a gun and he said he'll shoot me", "He says he'll kill me", "I'm scared he'll kill me", 'My son attacked me last night',
  'Mi esposo intentó matarme', 'Mi esposo trató de matarme', 'Mi esposo me amenaza con matarme', 'Mi esposo intentó ahorcarme',
  'Mi esposo intentó ahorcarme anoche', 'Él intentó matarme', 'Mi esposo me intentó matar', 'Mi esposo me trató de ahorcar',
  'Mi esposo quería matarme', 'Me amenaza con matarme', 'Me amenazó con matarme', 'Mi hijo me amenazó con matarme',
  'Mi esposo dijo que va a matarme', 'Él dijo que me va a matar', 'Dijo que me iba a matar', 'Mi esposo dice que me va a matar',
  'Mi esposo me amenaza de muerte', 'Mi esposo me amenazó con un cuchillo', 'Mi esposo me empujó por las escaleras',
  'Mi esposo me tiró por las escaleras', 'Mi esposo me aventó contra la pared', 'Mi esposo me agarró del cuello',
  'Mi hijo me dio una golpiza', 'Mi esposo me dio una paliza', 'Mi esposo me apuntó con una pistola', 'Me pega cuando bebe',
  'Él me quiere matar', 'Tengo miedo de que me mate', 'Mi hija me pegó un empujón', 'Mi esposo me pegó tan fuerte que fui al hospital',
];
const R4_NULL = [
  // "going to kill me" / "me va a matar" without explicit threat framing are figures of speech.
  "He's going to kill me", "He's going to kill me.", 'Me va a matar', 'Mi esposo me va a matar.', 'Hijo, la preocupación me va a matar', 'Esta angustia me va a matar',
  'Hijo, tu forma de beber me va a matar', 'Si tu papá se entera, me va a matar', 'Mi esposo me va a matar cuando vea la cuenta',
  "If your father finds out I gave you money, he's going to kill me.", 'She\'s going to kill me for telling you this',
  "He's going to kill me when he finds out I told you", 'My mom is going to kill me', "Dad's going to kill me if he finds out",
  "I'm scared he'll kill me if he finds out", 'Mi mamá me va a matar si se entera',
  // Shouts, colds, childhood history, old threats, and figurative pushes.
  'Mi hijo me pegó un grito', 'Mi esposo me pega gritos', 'Mi hijo me pegó la gripe', 'Mi esposo me pegó la costumbre de tomar café',
  'My dad hit me when I was a kid and I don\'t want that for you.', 'My father beat me when I was young.', 'My mom beat me as a kid.',
  'Mi papá me pegó cuando era niña.', 'Él me pegó una vez, hace años.', 'Remember when he hit me?',
  'He threatened to kill me last year when he was drinking and I never forgot it',
  'He pushed me away', 'She pushed me to get help', 'He pushed me into doing this intervention', 'My son pushed me into a corner with his lies',
  'He beat me at cards', 'My son beat me at chess', 'He beat me home', 'He kicked me out of the house', 'My husband hit me with the bill',
  'He hit me with a lot of questions', 'He hit me up on Facebook', "He's choking me with his control",
  'My husband punched me in the gut with that news.',
  // The loved one's classic denial line, and other idioms.
  "I'm only hurting myself", "It's my life, I'm only hurting myself", "I'm just hurting myself", 'Solo me hago daño a mí mismo',
  'Sólo me estoy haciendo daño a mí mismo', "I'm going to kill myself if I eat another piece of cake",
  'I want to kill myself every time I give you money.', 'I could kill myself for not seeing it sooner.',
  "I can't go on anymore like this, watching you destroy yourself.", 'When you drink, I want to die inside',
  "I'd rather die than watch you do this to yourself", "I'm so tired I could die", "I'm ready to die for my family",
  'Me estoy matando trabajando para pagar tu renta', 'Me da miedo que te mates',
];

Deno.test('round 4: unambiguous disclosures fire with the right kind (EN + ES)', () => {
  for (const text of R4_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  for (const text of R4_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
});

Deno.test('round 4: figures of speech, history, and denial lines never hard-break', () => {
  for (const text of R4_NULL) assertEquals([text, crisisKind(text)], [text, null]);
  // The partner may play the classic denial line without being regenerated.
  assert(!partnerReplyUnsafe("It's my life, I'm only hurting myself."), 'denial line is in character');
});

Deno.test('a break token in any spelling is never voiced as the loved one’s line', () => {
  for (const text of ['Break_Character: please call 988', 'BREAK CHARACTER', 'break-character:self_harm', 'Mom... BREAK_CHARACTER']) {
    assert(hasBreakToken(text) && partnerReplyUnsafe(text), text);
  }
  assert(!hasBreakToken('I need a break, Mom. You have no character.'), 'ordinary words');
});

// Round 5 audit: plainly worded current assaults and threats (recall — a false
// positive is recoverable with "I'm safe — keep practicing").
const R5_ABUSE = [
  'He just hit me.', 'My husband just hit me', 'He just choked me', 'My son just punched me', 'He just threatened to kill me',
  'He keeps hitting me', "He's threatening to kill me", "My husband's threatening to kill me", "He's been threatening to kill me",
  'he keeps threatening to kill me', "He's going to kill me tonight, he has a gun", 'My husband is abusing me',
  'Me volvió a pegar', 'Mi esposo me volvió a pegar', 'Me acaba de pegar', 'Mi hijo me acaba de pegar', 'Anoche me pegó.', 'Ayer me pegó',
  'Me trató de ahorcar', 'Me quiso ahorcar', 'Me está amenazando con matarme', 'Me pegó.', 'Me ahorcó', 'Me violó',
];
const R5_NULL = [
  'He just hit me up for money', 'He keeps pushing me to give him money', 'He keeps hitting me up for cash', 'My husband just hit me with the bill',
  'He really beat me at cards', "He's abusing me emotionally.", 'Ayer me pegó un susto', 'Me volvió a pegar la gripe', 'La noticia me pegó.',
  'Me violó la confianza que te tenía.',
];

Deno.test('round 5: plainly worded current assaults and threats are abuse (EN + ES)', () => {
  for (const text of R5_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
  for (const text of R5_NULL) assertEquals([text, crisisKind(text)], [text, null]);
});

// Round 6: past-progressive / "kept" / "choked me out" / "your father" forms are
// abuse; "be here" boundary lines and third-person "pushing me for/about" are not.
const R6_ABUSE = [
  'My husband was choking me last night.',
  "He was choking me and I couldn't breathe.",
  'My son was hitting me last night.',
  'He was strangling me.',
  'He kept hitting me.',
  'My husband kept hitting me last night.',
  'He kept choking me.',
  'He choked me out.',
  'Mi esposo me estaba ahorcando.',
  'Me estaba ahorcando anoche.',
  'Your father choked me last night.',
  'Tu papá me ahorcó.',
];
const R6_NULL = [
  "I don't want to be here and pretend everything is fine.",
  "I don't want to be here because I'm scared of you.",
  "I don't want to be here anymore, so I'm moving out.",
  'No quiero estar aquí y fingir que todo está bien.',
  'He keeps pushing me for money.',
  'He keeps pushing me about the car.',
  'My son pushed me too far.',
  'My son pushed me past my limit.',
  'My mom keeps pushing me about rehab.',
];
Deno.test('round 6: was/kept/choked-out/your-father assaults are abuse; boundary lines are not', () => {
  for (const text of R6_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
  for (const text of R6_NULL) assertEquals([text, crisisKind(text)], [text, null]);
  assertEquals(crisisKind('A veces me lastimo cuando estoy sola.'), 'self_harm');
  assertEquals(crisisKind("I don't want to be here anymore."), 'self_harm');
});
