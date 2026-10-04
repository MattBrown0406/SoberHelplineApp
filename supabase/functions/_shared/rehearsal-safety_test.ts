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
import { moderationCrisisKind, violenceAgainstHer } from './rehearsal-moderation.ts';

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

// Round 7: plainly worded emergencies in progress (EN + ES) — wrists, a weapon
// to her head, a jump, an overdose — and a weapon held on her.
const R7_SELF_HARM = [
  'I slit my wrists', "I cut my wrists and I'm bleeding", "I've just cut my wrists", "I'm going to slit my wrists tonight",
  'I have a gun to my head', "I've got a gun to my head", "I'm holding a knife to my throat",
  "I'm going to jump off a bridge", "I'm about to jump off the roof", "I'm on the bridge and I'm going to jump",
  'I took an overdose', "I've taken an overdose", 'I overdosed on my pills', 'I just overdosed on all my sleeping pills',
  'Me corté las venas', 'Me acabo de cortar las venas', 'Voy a cortarme las venas', 'Tomé todas mis pastillas',
  'Ya tome todas las pastillas', 'Me voy a tirar de un puente', 'Me quiero tirar desde el edificio',
];
const R7_ABUSE = [
  "He's threatening me with a knife", 'My husband is threatening me with a gun', "He's pointing a gun at me",
  'My son pointed a knife at me', 'He has a gun to my head', "He's holding a knife to my throat",
  "He won't let me leave the house and he has a gun", "He has a gun and he won't let me leave",
];
const R7_NULL = [
  'I cut my arm on the fence', "It's like I have a gun to my head with these bills",
  "I'm going to jump off a bridge if you relapse again", 'I took an overdose years ago and I know how that feels',
  'My son overdosed on heroin last year', 'He threatened me with a lawsuit', 'He pointed a finger at me',
  "He won't let me leave the house without a fight", 'No me voy a tirar de un puente', 'Mi hijo se cortó las venas el año pasado',
  'Tome todas las pastillas que le recetaron', "I'm on the bridge team at work", "I'm going to jump in and help",
];

Deno.test('round 7: emergencies in progress and weapons held on her break, with the right kind', () => {
  for (const text of R7_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  for (const text of R7_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
  for (const text of R7_NULL) assertEquals([text, crisisKind(text)], [text, null]);
});

// Round 8: perfect-tense and named-drug overdoses, counts, cutting in progress, a gun
// "to use", "end it tonight", Spanish jumps and cuts; contractions ("He's abusing me",
// "He's got a gun…"), "hurting me", rape, and a weapon with "no me deja salir".
const R8_SELF_HARM = [
  "I've taken all my pills", 'I have taken all my sleeping pills', "I've swallowed a bottle of pills",
  'I swallowed a bottle of Tylenol', 'I took a whole bottle of Tylenol', 'I took 50 Xanax', 'I just took 30 pills',
  'I took like 40 of my pills', 'I swallowed a handful of oxycodone', "I've just taken twenty Ambien", 'I took a bunch of Percocet',
  "I'm going to take 50 Xanax", "I'm going to swallow a bottle of Tylenol",
  "I'm cutting my wrists", 'I’m cutting my wrists right now', "I've been cutting my wrists", 'I cut my wrists on purpose',
  'I slit my wrists on the bathroom floor',
  "I have a gun and I'm going to use it", "I have a gun and I'm going to use it tonight", 'I’ve got a gun and I’ll use it',
  "I'm going to end it tonight", "I'm going to end it today.", "I'm going to end it now", 'I’m gonna end it tonight',
  "I'm going to end it all tonight.",
  'Voy a saltar del puente', 'Estoy en el puente y voy a saltar', 'Me voy a tirar del puente', 'Quiero saltar desde el edificio',
  'Voy a tirarme por la ventana', 'Me corté los brazos', 'Me corté las muñecas', 'Me corté las muñecas con un cuchillo',
  'Hoy me tomé todas las pastillas de una vez', 'Anoche tome todas mis pastillas',
];
const R8_ABUSE = [
  "He's abusing me", "My husband's abusing me", 'My husband’s abusing me.',
  "He's got a gun and he won't let me leave", 'He’s got a gun and he won’t let me leave',
  "My husband's got a gun and won't let me leave", "He's got a knife and he's threatening me",
  "They've got a gun and they won't let me leave",
  'My husband is hurting me', "He's hurting me right now", 'He’s hurting me.', 'My son keeps hurting me',
  "He's hurting me right now, please help",
  'I was raped last night', "I've been raped", 'I got raped', "I'm being raped",
  'Mi hijo tiene un cuchillo y no me deja salir', 'Mi hijo tiene un arma y me amenaza', 'Mi esposo tiene una pistola y no me deja irme',
  'No me deja salir y tiene un arma', 'Mi hijo tiene un arma y me está amenazando', 'Me está pegando', 'Mi esposo me pega',
];
const R8_NULL = [
  // Figures of speech, accidents, and things that aren't weapons in hand.
  "I'm on the edge of jumping to conclusions", "I'm on the edge of my seat jumping at every noise",
  'I cut my wrist on a broken glass', 'I cut my wrists by accident', 'I opened my wrist brace',
  "he's got a gun license", 'he has a knife collection', "He's got a gun license and threatened me with a lawsuit",
  'He threatened me with a lawsuit',
  // Daily meds, a normal dose, pills taken away, and old history.
  'Hoy tomé todas mis pastillas', 'Hoy me tomé todas mis pastillas', 'Hoy tome todas mis pastillas',
  'Tomé todas mis pastillas de la mañana', 'Tomé todas mis pastillas como me dijo el doctor',
  'I took 2 Tylenol for my headache', 'I took my pills', 'I took all my pills for today', "I've been taking all my pills",
  'I took 30 pills over the last month', 'I took 10 Advil a day for my back', 'I took a bottle of Xanax from his room',
  'I took 30 of his pills out of the cabinet', 'I took an overdose years ago',
  // Conditionals, negations, self-defense, and a jump that isn't one.
  "I'll jump off a bridge if you relapse", "I'm going to jump off a bridge if you relapse again",
  'Voy a saltar del puente si recaes', 'No voy a saltar del puente', 'Me voy a tirar de un puente si vuelves a beber',
  'Estoy en el puente y voy a saltar en paracaídas', 'Mi hijo tiene un arma',
  "I have a gun and I'm going to use it if he comes back", "I have a gun and I'll use it to protect myself",
  "I have a gun license and I'm going to use it",
  // "Hurting me" from anything but the abuser, or emotionally; second person is a line in her letter.
  "it's hurting me to watch him", 'his drinking is hurting me', 'you’re hurting me when you lie', "you're hurting me when you lie",
  "He's hurting me by using.", 'My son is hurting me so much with his drinking.', 'My daughter is hurting me and herself.',
  "He's hurting me with his drinking.", "He's hurting me, emotionally.", "He's been hurting me for years with his lies.",
  "He's abusing me emotionally.",
  // Ending the relationship, not her life.
  "I'm going to end it with him", "I'm going to end it with him tonight", "I'm going to end things with my husband tonight",
  "I'm going to end it tonight — the enabling.", 'I want to end it now, this cycle.',
  // A bare or accidental Spanish cut.
  'me corté cocinando', 'Me corté', 'Me corté la muñeca con un vidrio', 'Me corté el brazo', 'Me corté la muñeca cocinando',
  // Childhood history and the crude "overcharged" sense.
  'I was raped when I was a kid', 'I got raped on the price of that car', 'I was never raped',
];

Deno.test('round 8: overdoses, cuts, a gun, "end it tonight", jumps; contractions, hurting, rape — with the right kind', () => {
  for (const text of R8_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  for (const text of R8_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
});

Deno.test('round 8: figures of speech, accidents, daily meds, conditionals, and letter lines never hard-break', () => {
  for (const text of R8_NULL) assertEquals([text, crisisKind(text)], [text, null]);
  // The earlier forms these generalize still fire.
  for (const text of ['Tomé todas mis pastillas', 'Ya tome todas las pastillas', 'I took all my pills.', 'Me corté las venas']) {
    assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  }
});

// Round 9: how people actually type — no apostrophes ("im", "hes", "dont"), emoji
// at the end, run-ons ("…please help", "…rn", "…i cant do this"); "commit suicide";
// "my 19 yo son"; injuries; and a "no" that negates only its own verb phrase.
const R9_SELF_HARM = [
  // Apostrophe-less contractions.
  'im suicidal', 'im feeling suicidal', 'im having suicidal thoughts', 'ive been having suicidal thoughts', 'im going to overdose',
  'im going to od tonight', 'im going to take all my pills', 'ive taken all my pills', 'ive taken a bottle of pills',
  'im going to jump off a bridge', 'im on the bridge and im going to jump', 'im going to end it tonight', 'im done with life',
  'i have a gun and im going to use it', 'I have my husbands gun and Im going to use it', 'i cant go on anymore', 'i cant keep myself safe',
  'id rather be dead', 'ill end it all tonight',
  // Emoji and symbols where the sentence ends.
  'i want to die 😭', 'i want to die😭', 'I want to die 😢😢', 'i just want to die 😭', 'i wish i could die 😭', 'i want to end it all 😭',
  'i dont want to live anymore 😭', 'i dont want to live anymore 💔', 'i dont want to be here anymore 😭',
  'me quiero morir 😭', 'quiero morirme 😢', 'no quiero vivir mas 😭', 'ya no quiero vivir 💔',
  // Run-ons after the thought.
  'i want to die now', 'i want to die please help', 'i want to die i cant do this anymore', 'i want to die rn', 'i want to die tbh',
  'i want to die honestly', 'i want to die idk what to do', 'i dont want to live anymore please', 'i dont want to live anymore i cant do this',
  'me quiero morir ya', 'me quiero morir de verdad', 'quiero morir ya',
  // New first-person forms.
  'i want to commit suicide', "i'm going to commit suicide tonight", 'i am considering suicide', 'i feel like committing suicide',
  'i might commit suicide', 'suicide is all i think about', "there's no reason for me to live", 'theres no reason for me to live',
  'there is nothing left to live for', 'everyone would be better off if i was gone', 'todos estarian mejor sin mi',
  'Mis hijos estarían mejor sin mí.', 'i dont wanna live anymore', 'I said I want to die', 'I told my therapist I want to die',
  // A "no" earlier in the sentence doesn't negate "quiero morir".
  'ya no aguanto mas quiero morir', 'ya no puedo mas quiero morirme', 'ya no aguanto mas, quiero morir', 'no aguanto mas me quiero morir',
  'ya no puedo quiero morir',
];
const R9_ABUSE = [
  'hes hitting me', 'hes choking me', 'hes hurting me', 'hes been hitting me for months', 'he said hes going to kill me',
  'im scared hes going to kill me', 'im afraid hes going to kill me', 'my son has a knife and wont let me leave',
  'my 19 yo son hit me', 'my 19 yo son hit me in the face', 'my 19 year old son hit me', 'my 19-year-old son hit me', 'my adult son hit me',
  'my oldest son punched me', 'my ex husband hit me', 'my ex-husband hit me', 'my stepson hit me', 'my stepdaughter punched me',
  'my grandson hit me', 'my granddaughter hit me', 'my fiance hit me', 'my fiancé choked me',
  'he broke my nose', 'my husband broke my ribs', 'my son broke my arm', 'He gave me a black eye',
  'mi hijo de 19 años me pegó', 'mi ex esposo me pegó', 'mi hijo me golpeo', 'mi hijo me golpeo anoche', 'mi esposo me esta golpeando',
];
const R9_NULL = [
  // Over-trips the audit found.
  'me lastimo lo que hiciste', 'me lastimo que no vinieras a la boda', 'me lastimo tu silencio', 'i took all my meds today',
  'i took all my meds today like the doctor said', 'he hits me up every day asking for money', 'He keeps hitting me up every day',
  'im killing myself here', 'he hit me where it hurts', 'he hits me where it hurts',
  // The new run-on endings stop short of figures of speech and the loved one's quoted words.
  'i want to die of embarrassment 😂', 'i want to die laughing', 'i want to die when i see you like this',
  'When you said I want to die, I froze', 'when you said “i want to die” i was terrified', 'me quiero morir de la vergüenza 😂',
  'Quiero morir contigo.', "I don't want to live with an addict", "I don't wanna live like this anymore", 'i dont want to live in fear anymore',
  "there's no reason to live like this", "There's no reason for me to live with him anymore",
  'everyone would be better off if i was gone for the weekend',
  // Suicide that isn't hers, or isn't intent.
  'I will never commit suicide', "I'm not going to commit suicide", 'my daughter attempted suicide last year and is doing well',
  'I attempted suicide in 2010',
  // A "no" still negates its own verb phrase.
  'No me quiero morir', 'No quiero morir', 'Hoy no me quiero morir', 'nunca me voy a matar', 'no tengo ganas de morir', 'Ya no puedo más',
  // "id" / "ill" are words too.
  'ill be fine', 'my ID is in my purse',
  // Injuries she caused herself, or that aren't injuries, or are childhood history.
  'I broke my arm', 'my son broke my heart', 'he broke my phone', 'you broke my nose', 'my dad broke my arm when I was a kid',
  "my son's girlfriend hit me up",
];

Deno.test('round 9: typed without apostrophes, with emoji, or running on — and new first-person forms — break, with the right kind', () => {
  for (const text of R9_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  for (const text of R9_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
});

Deno.test('round 9: over-trips, figures of speech, quoted words, and negations stay in the practice', () => {
  for (const text of R9_NULL) assertEquals([text, crisisKind(text)], [text, null]);
  // Still bounded: text past MAX_SCREEN_CHARS is never scanned, emoji or not.
  assert(!userInCrisis(`${'😭'.repeat(MAX_SCREEN_CHARS / 2)} i want to die`), 'unbounded scan');
});

// Round 10: assaults told the way they're usually told (two steps, weapons, "won't stop"),
// in English and Spanish; line breaks, emoji and emoticons end the sentence; a dropped
// "I" at the start of a sentence; and the loved one's quoted words are not hers.
const R10_ABUSE = [
  // Weapons and assault verbs.
  'he stabbed me', 'my son stabbed me last night', 'my husband stabbed me in the arm', 'he just stabbed me', 'he shot me', 'he just shot me',
  'he shot at me', 'he cut me with a knife', 'he burned me with a cigarette', 'he bit me', 'my husband smacked me', 'he smacked me across the face',
  'he whooped me', 'he sexually assaulted me', 'he forced himself on me', 'he dragged me by my hair', 'he pulled my hair and slapped me',
  'he came at me with a knife', 'my son came at me with a bat', 'my son is chasing me with a knife', 'he held the gun to my head',
  'he held the gun to my head and said hed kill me', 'he pulled the gun on me', 'he held me down', 'he tried to run me over', 'he ran me over with the car',
  'he hurt me bad, im bleeding', 'he locked me in and has a gun', 'he made me take all my pills', 'he forced me to swallow a bottle of pills',
  // Two steps.
  'he got drunk and hit me', 'he came home drunk and hit me again', 'my husband got drunk and beat me', 'he got mad and punched me',
  'he grabbed me and choked me', 'he pinned me down and choked me', 'he threw me down and kicked me', 'he gets drunk and hits me',
  // Won't stop.
  "he won't stop hitting me", 'he wont stop hitting me', 'he never stops hitting me', 'he doesnt stop hitting me',
  // Separators.
  'my husband hit me\nwhat do i do', 'he hit me — what do i do', 'he hit me 😢',
  // Spanish.
  'me apuñaló', 'mi hijo me apuñaló', 'me acuchilló', 'me disparó', 'mi esposo me disparó', 'mi hijo me cortó con un cuchillo',
  'llegó borracho y me pegó', 'mi esposo llegó borracho y me pegó', 'llego borracho y me pego otra vez', 'se enojó y me golpeó', 'se emborrachó y me golpeó',
  'me agarró y me ahorcó', 'me pegó y me dejó un ojo morado', 'me violó anoche', 'mi marido me violó anoche', 'me quiere matar', 'me quiere matar ayuda',
  'me quiere matar, tiene un cuchillo', 'tiene una pistola y me quiere matar', 'creo que me va a matar esta noche', 'me ahorcó hasta que me desmayé',
  'me dio una cachetada', 'me dio una patada', 'me dio un puñetazo en la cara', 'mi hijo me dio una cachetada', 'me pegó una cachetada', 'me agarró a golpes',
  'me jaló del pelo', 'mi esposo me jalo del pelo', 'me jaló del pelo y me tiró al piso', 'me tiró al suelo y me pateó', 'me empujó contra la pared',
  'me puso un cuchillo en el cuello', 'me encerró y tiene un cuchillo', 'no para de pegarme', 'mi esposo no deja de pegarme',
];
const R10_SELF_HARM = [
  // Line breaks, emoji, emoticons and asides end the sentence.
  'i want to die\nhe relapsed again', 'i want to die\n\nhe relapsed again', 'i dont want to live anymore\nwhats the point', 'quiero morirme\nno se que hacer',
  'i’m done with life\nnothing matters', 'i wish i could die\nhonestly', 'i want to die :(', "i want to die :'(", 'i want to die :/ he relapsed',
  'i want to die 😭 he relapsed again', 'i want to die - he relapsed again', 'i want to die — he relapsed again', 'i want to die (seriously)',
  'i want to die *sigh*', 'i dont want to live anymore — whats the point', 'me quiero morir — ya recayó otra vez', 'i want to die </3',
  // Run-ons.
  'honestly i want to die at this point', 'i want to die after everything', 'i want to die from all this', 'i want to die ugh', 'i want to die omg',
  'i want to die fr', 'i want to die bc of everything', 'i want to die cuz i failed him', 'i want 2 die', 'me quiero morir honestly', 'quiero morir rn',
  'quiero morirme honestly',
  // New forms.
  'i want to be dead', 'i just want to be dead', 'i want to kill my self', 'im gonna kill my self tonight', 'i want to hurt my self', 'i kill my self',
  'i just overdosed', 'i think i overdosed', 'i just od’d', 'i overdosed', 'nobody would miss me if i died', 'im thinking about ending it all',
  'imma end it all tonight', 'quiero estar muerta', 'quisiera estar muerta', 'tome un frasco de pastillas',
  // A dropped "I".
  'took all my pills', 'took a bottle of pills', 'just took a bunch of pills', 'just want to die', 'just want to die tbh', 'want to die', 'wanna die',
  'feeling really suicidal tonight', 'thinking of ending it all',
];
const R10_NULL = [
  // Figures of speech, and what she says to the loved one.
  "you're killing yourself", 'when you said you wanted to die', 'you hit me', 'he hit me up', 'he beat me at cards', "i'm killing myself working two jobs",
  'im being hit with bills from your rehab', 'i feel like im being beaten down by all this', 'me dio una paliza jugando cartas', 'he shot me a look',
  'he shot me a text', 'my son shot me a quick text', 'he shot me down', 'he stabbed me in the back', 'he got home and hit me up for money',
  'he came over and beat me at cards', 'he grabbed his phone and shot me a dirty look', 'he called and hit me with the news', 'he hit me with his car payment',
  'he burned me with his words', 'he held me back', 'when he gets drunk and hits me up for cash', 'la vida me dio un golpe duro', 'me dio un golpe de suerte',
  'la noticia me tiró al suelo', 'Mi esposo me quiere matar cuando vea la cuenta', 'Mi mamá me quiere matar de un susto', 'si se entera me va a matar esta noche',
  'me disparó una pregunta', 'y me empujó a buscar ayuda', 'Ayer me violó la confianza', 'me tiene encerrada', 'he wont let me leave',
  // History.
  'my dad dragged me by my hair when I was a kid', 'he forced me to take all my pills when I was a kid',
  // Daily meds, a headache, accidents.
  'i took all my meds today', 'i took all my pills before bed like the doctor said', 'i took all my sleeping pills to the pharmacy to dispose',
  'i took a handful of advil, my head is pounding', 'i hurt myself when i fell off the ladder', 'i cut myself shaving', 'i burned myself cooking',
  'i cant keep myself safe if you keep driving drunk with the kids',
  // The loved one's quoted words.
  'last week you texted me “i want to die” and i was terrified', 'you texted me "i want to die" and i was terrified',
  'you texted me “i want to kill myself” at 3am', 'you said to me “i want to die” and walked away', 'you looked at me and said “i want to die” and i froze',
  'when you said “mom i want to die” i couldnt breathe', 'you wrote “im going to kill myself” on facebook', 'you posted “i want to end it all” and i panicked',
  'you said, “i want to die.” i was so scared', 'your text said i want to die and i called 911', 'the night you said im going to kill myself i didnt sleep',
  'dijiste “me quiero morir” y me asustaste', 'me escribiste “me voy a matar”', 'tu dijiste quiero morir y me asuste',
  // A dropped subject that is a question to him, or harmless.
  'Want to die? Keep drinking like this.', 'Took my son to his assessment today', 'Thinking about you', 'Don’t want to live like this anymore',
  // "my self-esteem", symbols that aren't emoticons.
  'my self esteem is gone', 'he destroyed my self-esteem', 'i love you <3', 'I need a break :)', 'Note: (see attached)', 'at 3:30 he came home',
  "I'm going to end it tonight — the enabling.", "I don't want to be here — and pretend everything is fine.",
];

Deno.test('round 10: assaults told in two steps, with weapons, or "won\'t stop" are abuse (EN + ES)', () => {
  for (const text of R10_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
});

Deno.test('round 10: line breaks, emoji, run-ons, a dropped "I", and new forms are self-harm', () => {
  for (const text of R10_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  // Her own words still count when she reports them.
  for (const text of ['I said I want to die', 'le dije que me quiero morir', 'my husband choked me and i want to die']) {
    assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  }
});

Deno.test('round 10: figures of speech, history, daily meds, accidents, and quoted lines stay in the practice', () => {
  for (const text of R10_NULL) assertEquals([text, crisisKind(text)], [text, null]);
});

Deno.test('round 10: pathological input stays fast once the patterns are warm', () => {
  const fill = (unit: string) => unit.repeat(Math.ceil(MAX_SCREEN_CHARS / unit.length)).slice(0, MAX_SCREEN_CHARS);
  const inputs = [fill('’'), fill('1'), fill('a'), fill('my '), fill('he '), fill('i '), fill('no me '), fill('😭'), fill('i’m '), fill('he got drunk and ')];
  for (const text of inputs) crisisKind(text);
  for (const text of inputs) {
    const start = performance.now();
    crisisKind(text);
    const ms = performance.now() - start;
    assert(ms < 250, `${JSON.stringify(text.slice(0, 12))}… took ${ms.toFixed(1)} ms`);
  }
});

// Round 11: abuse told the way it's typed — progressive ("he's trying to kill me rn"),
// passive ("I was beaten by my husband"), euphemisms ("he put his hands on me"), more
// relations ("my hubby", "mi yerno"), words between who and verb ("my son who is using
// meth hit me", "my son (22)"), Spanglish; Spanish attempts that were self-harm; slang.
const R11_ABUSE = [
  'my son is trying to kill me', 'hes trying to kill me rn', 'he is trying to strangle me', 'my husband is attacking me',
  'my son is attacking me with a knife', 'he has a knife and hes coming at me', 'my son has a gun and hes pointing it at me', 'my son is stabbing me',
  'my husband is raping me', 'hes slapping me', 'hes dragging me by my hair', 'hes holding me down', 'he is choking me out', 'hes beating on me',
  'hes beatin me', 'hes drunk and beating me', 'my son is high and hitting me', 'he is screaming that he will kill me', 'my son wants to kill me',
  'he will kill me', 'hes gonna kill me tonight', 'i think my husband is going to kill me tonight',
  'i was beaten by my husband last night', 'i was choked by my boyfriend', 'i was attacked by my son', 'i got beat up by my son',
  'my son put his hands on me last night', 'he put his hands on me again', 'he laid hands on me', 'my husband got physical with me', 'he roughed me up',
  'he knocked me out', 'he threw a chair at me', 'my son jumped me',
  'my hubby hit me', 'my hubby is choking me', 'my bf punched me', 'my ex bf choked me last night', 'my DH hit me last night', 'my baby daddy beat me up',
  'my nephew punched me', 'my son in law hit me', 'my son-in-law hit me', 'my sons been hitting me', 'my husbands been beating me for months',
  "my son's been hitting me", "he said he'd kill me if i called the cops", 'he said hed kill me if i called the cops',
  'my son who is using meth hit me last night', 'my husband who is drunk right now just hit me', 'my son literally just hit me',
  'my son (22) hit me last night', 'my son, 25, punched me',
  'mi esposo me quiere hacer daño', 'mi esposo me está lastimando', 'mi hijo me lastimó, estoy sangrando', 'mi hijo me quemó con un cigarro',
  'mi hijo me rompió la nariz', 'fui golpeada por mi esposo', 'mi esposo me tiene amenazada con una pistola', 'mi hijo amenaza con hacerme daño',
  'mi esposo amenazó con lastimarme', 'mi yerno me pegó', 'mi sobrino me golpeó', 'mi hijo borracho me pegó', 'mi hijo que usa drogas me pegó',
  'mi esposo hit me again', 'mi hijo hit me otra vez', 'mi husband me pegó', 'my hubby me golpeó', 'mi hijo is choking me',
  // Spanish attempts and fears that were self-harm through "matarme".
  'mi esposo intenta matarme', 'mi hijo esta intentando matarme', 'mi hijo está tratando de matarme', 'mi esposo trata de matarme',
  'mi hijo puede matarme', 'tengo miedo de que mi esposo vaya a matarme',
];
const R11_SELF_HARM = [
  'i want to kms', 'im gonna kms', 'i want to unalive myself', 'im going to off myself', 'i want to off myself', "i'm ready to end my life",
  "i'm about to end my life", "i am ready to end my life", 'i wish i wasnt alive', 'kiero morir', 'me kiero matar', 'me quiero morir neta',
  'i just want to morir', 'im going to drive my car off a bridge',
];
const R11_NULL = [
  // Her letter lines to him, in Spanish, and his pills taken away.
  'Me amenazaste con matarme cuando te quité las llaves.', 'Me dijiste que ibas a matarme si llamaba a la policía.', 'cuando intentaste matarme me fui de la casa',
  'esa noche quisiste matarme', 'tú querías matarme', 'vas a matarme de un susto', 'Vas a matarme del susto un día de estos.', 'dijiste que ibas a matarme',
  'Esa noche intentaste ahorcarme y yo te seguí defendiendo.', "I'm going to take all the pills and flush them.", 'im going to take all the pills and lock them in my car',
  "i'm gonna take all the meds and hide them", 'I have the pills right here, I took them from your room.', 'im killing myself with worry over you',
  'when your father hit me, you saw it', "you're going to make me kill myself", 'When your dad hit me last year, you were 10',
  // Figures of speech and things the new forms must not swallow.
  'my son who is in rehab hit me up for money', 'I was hit by a car', "I got hit by my son's car", 'I was beaten by my husband at chess',
  'I got beat by my son at cards', 'he knocked me up', "He's attacking me about money", 'my son is trying to kill me with his drinking',
  "he's trying to kill me lol", 'my son is trying to kill me with stress', 'My son wants to kill me for grounding him.', 'he hits on me',
  'he threw the book at me', 'he knocked me down a peg', 'my husband attacked me for setting a boundary.', 'he got drunk and hit me up for money',
  "He's going to kill me", "He's going to kill me when he finds out I told you", "my son's been calling me",
  'Mi esposo me quiere hacer daño con sus palabras', 'Mi hijo me puede matar de un disgusto', 'mi hijo puede matarme de un susto', 'fui golpeada por la vida',
  'Mi esposo me va a matar.', 'I drove 50 kms today', 'I took the pressure off myself', 'I need to take some weight off myself', 'he unalived the account',
];

Deno.test('round 11: abuse she is suffering — progressive, passive, euphemisms, more relations, Spanglish — is abuse', () => {
  for (const text of R11_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
});

Deno.test('round 11: self-harm slang and "ready / about to end my life" are self-harm', () => {
  for (const text of R11_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
});

Deno.test('round 11: second-person Spanish lines, pills taken away, and figures of speech stay in the practice', () => {
  for (const text of R11_NULL) assertEquals([text, crisisKind(text)], [text, null]);
});

const moderated = (categories: Record<string, boolean>, scores: Record<string, number> = {}) => ({ results: [{ categories, category_scores: scores }] });

Deno.test('round 11: a moderation violence verdict is abuse only when she is the victim and the line is not to him', () => {
  const violence = moderated({ violence: true });
  const ON = { violence: true };
  for (const text of [
    'he hit me', 'my son put his hands on me', 'i was beaten by my husband last night', 'he broke my nose', 'he slammed me into the dresser',
    'something happened, he hurt me bad', 'mi hijo me pegó', 'fui golpeada por mi esposo', 'empezó a golpearme', 'he threatened my life',
  ]) {
    assert(violenceAgainstHer(text), `victim: ${text}`);
    assertEquals([text, moderationCrisisKind(violence, text, ON)], [text, 'abuse']);
  }
  assertEquals(moderationCrisisKind(moderated({ 'harassment/threatening': true }), 'mi esposo me amenazó de muerte', ON), 'abuse');
  // Lines spoken to the loved one, violence at things or other people, and her own anger stay in the practice.
  for (const text of [
    "if you hit me again I'll call the police", 'when you threw the chair at me I was terrified', 'u hit me last year', 'your father hit me',
    'me pegaste cuando estabas borracho', 'Esa noche intentaste ahorcarme', 'Cuando me empujaste contra la pared, te tuve miedo.', 'tú me pegaste',
    'he punched a hole in my wall', 'he punched the wall', 'my son beat up his brother', "I'm going to kill him", 'he smashed my phone',
  ]) {
    assert(!violenceAgainstHer(text), `not hers / to him: ${text}`);
    assertEquals([text, moderationCrisisKind(violence, text, ON)], [text, null]);
  }
});

Deno.test('round 11: moderation self-harm keeps its rules and wins over violence; bad payloads are nothing', () => {
  assertEquals(moderationCrisisKind(moderated({ 'self-harm/intent': true, violence: true }), 'he hit me and I want to die'), 'self_harm');
  assertEquals(moderationCrisisKind(moderated({ 'self-harm': true }, { 'self-harm/intent': 0.4 }), 'x'), 'self_harm');
  assertEquals(moderationCrisisKind(moderated({ 'self-harm': true }, { 'self-harm/intent': 0.01 }), 'when you overdosed'), null);
  assertEquals(moderationCrisisKind(moderated({}), 'he hit me'), null);
  assertEquals(moderationCrisisKind(null, 'he hit me'), null);
  assertEquals(moderationCrisisKind({ error: 'x' }, 'he hit me'), null);
  // moderationIndicatesCrisis itself is unchanged: violence alone is not self-harm.
  assert(!moderationIndicatesCrisis(moderated({ violence: true })), 'violence alone');
});

// Round 12: "i've got" (the contraction never had a space), Spanish overdoses and
// hangings, adverbs before "beat me up", "down the stairs", us / nos, Spanish
// pronoun-first continuations, and accent-dropped preterites that are his doing.
const R12_SELF_HARM = [
  "i've got my pills ready", 'ive got the pills ready', "i've got the pills in my hand", "i've got nothing left to live for", 'ive got nothing to live for',
  "i've got no reason to live for", 'i honestly dont want to be alive anymore', 'i just dont want to live anymore', 'i really dont want to be alive anymore',
  "i just don't want to be here anymore.", "i'm better off dead", 'im better off dead honestly', 'everyone is better off without me',
  "i'm going to drive off a bridge",
  'me tomé 30 pastillas', 'me tome 30 pastillas', 'me acabo de tomar 20 pastillas', 'me tomé como 40 pastillas para dormir', 'me tomé muchas pastillas',
  'me tomé un montón de pastillas', 'me tomé todo el frasco', 'me tomé el frasco entero', 'me tomé toda la caja de pastillas', 'me tomé una caja entera de pastillas',
  'me tragué todas mis pastillas', 'me tragué un frasco de pastillas', 'me tragué todas las pastillas',
  'quiero acabar con mi vida', 'voy a acabar con mi vida', 'voy a terminar con mi vida', 'me quiero ahorcar', 'voy a ahorcarme', 'quiero ahorcarme',
  'me voy a ahorcar', 'me voy a colgar', 'me quiero colgar',
  // Self-harm still wins when both are disclosed.
  'my son hit me again and honestly i dont want to be alive anymore', "my husband hit me again. i've got nothing left to live for",
  'he beat me up and im better off dead', 'mi esposo me pegó otra vez y quiero acabar con mi vida', 'mi hijo me pegó y me tomé 30 pastillas',
];
const R12_ABUSE = [
  'my son just beat me up', 'he really beat me up', 'he finally beat me up', 'he beat the crap outta me', 'he pushed me down', 'he just pushed me down',
  'he shoved me down hard', 'my husband shoved me down', 'he kicked me down the stairs', 'he just threw me down the stairs', 'he just pushed me down the stairs',
  'my son just shoved me down the stairs', 'he pushed me down the stairs again', 'he texted me that he\'s going to kill me',
  'my son put me in a chokehold', "he's swinging a bat at me", 'hes standing over me with a knife', 'my son has my gun and says he will shoot me',
  'he hurt me really bad last night, i have bruises everywhere', 'he slammed my hand in the door', 'he twisted my arm until it cracked',
  'my son is attacking us', 'he is hitting us', 'my husband is beating us', 'my husband beat us last night', 'my son just attacked us with a knife',
  'he threatened to kill us', "he's going to kill us tonight", 'he says he is going to kill us all', 'we were attacked by my son', 'got beat up by my son last night',
  'mi hijo me sigue pegando', 'me sigue golpeando', 'mi esposo me sigue golpeando', 'me sigue pegando cada vez que toma', 'me empezó a pegar',
  'mi hijo empezó a golpearme', 'me pateó en el estómago', 'mi ex me está siguiendo con un cuchillo', 'mi hijo nos está pegando', 'mi esposo nos quiere matar',
  'nos amenazó con un cuchillo', 'anoche me golpeo', 'me golpeo anoche', 'otra vez me golpeo', 'me lastimo anoche', 'ayer me lastimo', 'mi esposo me lastimo anoche',
  'ayer me golpeo y me dejo moretones', 'me quemo con un cigarro',
];
const R12_NULL = [
  "i'm ready to die on this hill", 'i cut myself on a broken glass', 'my brother tried to choke me when we were kids', 'he pushed me down the list',
  'he let me down', 'she pushed me down the priority list', 'he hits us up for money', 'he beat us at cards', 'the bills are killing us', 'he attacked us on facebook',
  'Tu papá me pegaba y yo no quiero eso para ti.', 'ayer me lastimó mucho lo que dijiste', 'me lastimo ayer con sus palabras', 'mi hijo me sigue pegando gritos',
  'Hoy me tomé todas mis pastillas', 'me tomé muchas pastillas para el dolor', 'voy a colgar el teléfono', 'me voy a colgar del teléfono', 'quiero acabar con todo',
];
Deno.test('round 12: "i\'ve got", Spanish overdoses and hangings, and "better off" forms are self-harm (and win over abuse)', () => {
  for (const text of R12_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  // Her own present self-harm is still hers: "me golpeo la cabeza contra la pared", "me corto".
  for (const text of ['Me golpeo la cabeza contra la pared.', 'Me corto.', 'A veces me lastimo.']) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
});
Deno.test('round 12: adverbs, "down the stairs", us / nos, Spanish continuations and accent-dropped preterites are abuse', () => {
  for (const text of R12_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
});
Deno.test('round 12: figures of speech, childhood history, letter lines and routine meds stay in the practice', () => {
  for (const text of R12_NULL) assertEquals([text, crisisKind(text)], [text, null]);
});

const VIOLENCE = { results: [{ categories: { violence: true } }] };
const THREAT = { results: [{ categories: { 'harassment/threatening': true } }] };
const ON = { violence: true };
Deno.test('round 12: the violence backstop is off unless the per-line gate asks for it', () => {
  // Debrief and transcripts call without the option: violence alone is never a pause there.
  for (const text of ['he hit me', 'my son is attacking us', 'mi hijo me sigue pegando']) assertEquals(moderationCrisisKind(VIOLENCE, text), null);
  // Self-harm still counts everywhere.
  assertEquals(moderationCrisisKind({ results: [{ categories: { 'self-harm/intent': true } }] }, 'x'), 'self_harm');
  assertEquals(moderationCrisisKind(VIOLENCE, 'he hit me', ON), 'abuse');
  assertEquals(moderationCrisisKind(THREAT, 'he hit me', ON), 'abuse');
});
Deno.test('round 12: the backstop sees her disclosures — with "us", "can you help", no subject — but not history, news, others, or boundaries', () => {
  for (const text of [
    'my son just beat me up', 'he kicked me down the stairs', 'he pushed me down and kicked me in the ribs', 'mi hijo me sigue pegando', 'me empezó a pegar otra vez',
    "he's swinging a bat at me", 'hes standing over me with a knife', 'my son put me in a chokehold', 'he slammed my hand in the car door',
    'me pateó en el estómago', 'mi ex me está siguiendo con un cuchillo', 'got beat up by my son last night', 'im being hit',
    'he punched a hole in the wall right next to my head', 'my husband threw the remote and it hit my face',
    'my son is attacking us', 'he is hitting us', "he's going to kill us tonight", 'we were attacked by my son', 'mi hijo nos está pegando', 'mi esposo nos quiere matar',
    'he beat the crap outta me, can you help', 'sorry i have to stop, my son just shoved me down the stairs, are you there',
    'he kicked me down the stairs. what do you think i should do', 'please tell me what to do, you have to help, my son is attacking us',
    'ayúdame por favor, mi hijo me sigue pegando, tú qué harías', 'i got beat up by my son last night i need you to know this is real',
  ]) assertEquals([text, moderationCrisisKind(VIOLENCE, text, ON)], [text, 'abuse']);
  for (const text of [
    // Others, property, the news, history, generic subjects and boundaries.
    "I'm going to kill him if he touches my daughter", 'my son beat up his brother last night', 'he hit his girlfriend and she called me crying',
    'his dealer beat him up and he called me for money', 'mi hijo le pegó a su hermano', 'he punched a hole in the wall', 'he slashed my tires', 'my son trashed my car',
    'I saw on the news a mom was stabbed by her son and it scared me', 'a guy got shot down the street from me last night', 'that movie where the son kills his mother haunted me',
    'vi en las noticias que un hijo mató a su mamá y me dio miedo', 'my dad hit me when I was little', 'my stepdad used to choke me when I was a teenager',
    'mi papá me pegaba cuando era niña', 'de niña me golpeaban mucho', 'I was raped in college', 'years ago my first husband broke my nose',
    'Mike, nobody puts their hands on me in this house again.', 'If anyone lays a hand on me again, I call 911. That is my boundary.',
    'Throwing things at me is where I draw the line.', 'That night with the knife scared me to death, Danny.', 'I ended up in the ER after the fight.',
    'Nadie me vuelve a pegar en esta casa.', 'Mijo, esa noche del cuchillo me dio mucho miedo.', "I won't live with someone who hits me.",
    "I've been hit for the last time.", "I'm not going to let anyone hurt me again.", 'Hitting me is not something I will ever accept again.',
  ]) assertEquals([text, moderationCrisisKind(VIOLENCE, text, ON)], [text, null]);
});
Deno.test('round 12: letter lines to him never trip the backstop — English and Spanish, past, present, subjunctive', () => {
  for (const text of [
    'when you threw the chair at me I was terrified', 'if you put your hands on me again, I am calling the police', 'You hit me in front of our daughter.',
    'Last Christmas you broke my nose. I covered for you.', "You choked me until I couldn't breathe.", 'u hit me in front of the kids', 'ur not allowed to hit me ever again',
    'Cuando tomas, me pegas.', 'Me empujaste contra la pared y todavía me duele.', 'Si me vuelves a pegar, llamo a la policía.', 'Me amenazaste con un cuchillo.',
    'Me pegas delante de los niños.', 'No voy a dejar que me golpees otra vez.', 'Cada vez que bebes, me gritas y me empujas.', 'Me ahorcaste hasta que casi me desmayo.',
    'Tu papá me pegaba y yo no quiero eso para ti.', 'Cuando me golpeas, los niños lo ven.', 'Me jalaste del pelo y me arrastraste.', 'Me amenazas con matarme cuando estás borracho.',
    'Me lastimas cada vez que consumes.', 'Me da terror que me mates un día.', 'Me empujas, me insultas y luego me pides perdón.', 'No quiero que me vuelvas a tocar así.',
    'Me apuntaste con la pistola de tu papá.', 'Cuando consumes, me tratas a golpes.', 'Ya no voy a esconder los moretones que me dejas.', 'Me agarras del cuello cuando te enojas.',
    'Si me vuelves a amenazar con el cuchillo, me voy.', 'cuando te emborrachas me pegas', 'me golpeas y después me pides perdón', 'hijo, me pegaste anoche y no voy a callarme',
  ]) assertEquals([text, moderationCrisisKind(VIOLENCE, text, ON)], [text, null]);
});

// Round 13: "my Xs hitting me" read as "my X's", dropped g ("hittin"), "my husband of
// 20 years", "the father of my kids", the person after the verb in Spanish ("me pegó mi
// esposo"), and the self-harm forms the auditor found.
Deno.test('round 13: "my Xs …" is "my X\'s …" for every relation and verb (but plurals stay plural)', () => {
  const rels = ['husband', 'son', 'boyfriend', 'bf', 'ex', 'hubby', 'daughter', 'stepson'];
  const tails = [
    'hitting me', 'beating me', 'choking me', 'strangling me', 'punching me', 'kicking me', 'trying to kill me', 'attacking me', 'hurting me',
    'threatening to kill me', 'going to kill me tonight', 'drunk and hitting me', 'beating me up', 'holding a knife to my throat', 'pointing a gun at me',
  ];
  for (const r of rels) {
    for (const t of tails) {
      assertEquals([`my ${r}s ${t}`, crisisKind(`my ${r}s ${t}`)], [`my ${r}s ${t}`, 'abuse']);
      assertEquals([`my ${r}'s ${t}`, crisisKind(`my ${r}'s ${t}`)], [`my ${r}'s ${t}`, 'abuse']);
    }
  }
  for (const text of ['my sons are hitting each other', 'my sons hitting each other again', 'my daughters were fighting', 'my sons have been drinking']) {
    assertEquals([text, crisisKind(text)], [text, null]);
  }
});

Deno.test('round 13: Spanish — who before or after the verb, accented or not, with or without a time word — is abuse', () => {
  const verbs = ['pegó', 'golpeó', 'pateó', 'ahorcó', 'lastimó', 'empujó', 'violó'];
  const who = ['mi esposo', 'mi hijo', 'mi marido', 'mi novio', 'mi pareja'];
  for (const accent of [true, false]) {
    for (const v0 of verbs) {
      const v = accent ? v0 : v0.replace('ó', 'o');
      for (const s of who) {
        for (const text of [`${s} me ${v}`, `me ${v} ${s}`, `me ${v} ${s} anoche`]) assertEquals([text, crisisKind(text)], [text, 'abuse']);
      }
    }
  }
  for (const text of [
    'me golpeo mi esposo y estoy sangrando', 'me lastimo mi hijo anoche', 'me pegó fuerte mi esposo', 'me golpeo en la cara mi esposo', 'me pegó el papá de mis hijos',
    'el papá de mis hijos me pegó', 'mi esposo me pegó fuerte', 'me pegó bien feo', 'Me pegaron.', 'me pegó mi hijo y estoy sangrando',
  ]) assertEquals([text, crisisKind(text)], [text, 'abuse']);
  for (const text of [
    'me pegó la gripe mi hijo', 'me cortó el pelo mi hija', 'me quemó la comida mi esposo', 'me lastimó mi esposo con sus palabras', 'Me empujó mi esposo a buscar ayuda',
    'Mi esposo me pega gritos', 'Mi hijo me pegó un grito', 'Mi hijo me pegó la gripe', 'Él me lastima con sus mentiras.', 'me pegó muy fuerte la noticia',
    'Me pegó muy duro verte en el hospital.', 'Me quemo cada vez que cocino.',
  ]) assertEquals([text, crisisKind(text)], [text, null]);
  // Her own present self-harm stays hers when the relation is only in a later clause.
  for (const text of ['Me lastimo cuando mi esposo grita', 'me golpeo la cabeza cuando mi hijo se droga', 'me quemo cuando estoy triste', 'Me golpeo la cabeza contra la pared.']) {
    assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  }
});

const R13_ABUSE = [
  'hes hittin me rn', 'hes chokin me', 'hes punchin me', 'hes kickin me', 'my husbands beatin me', 'he keeps hittin me', 'my husband of 20 years hit me',
  'my husband of 20 years hit me last night', 'the father of my kids hit me', 'my kids father hit me', 'my husband put me in the hospital',
  'my son put me in the hospital last night', 'my husband hit my daughter and me', 'he hit the kids and me', 'he busted my lip', 'he split my lip',
  "he's holding me hostage", 'he is holding me hostage in the house', 'can you call 911 my sons hitting me',
];
const R13_SELF_HARM = [
  'i have no reason to live', 'i honestly have no reason to live anymore', 'i have no reason to live anymore', "i wish i'd never been born", 'i wish i had never been born',
  'i swallowed all my husbands pain pills', 'i took my whole bottle of sleeping pills', 'im seriously thinking about suicide', 'i attempted suicide yesterday',
  'i attempted suicide last night', 'i tried to overdose', 'i drank a bottle of bleach', 'i burned myself on purpose', 'quiero dormir y no despertar',
  'me hice daño a propósito', 'no quiero vivir anymore', 'me siento suicidal', 'estoy suicidal', 'estoy suicida',
];
const R13_NULL = [
  'I took my whole bottle of pills to the pharmacy', 'i tried to overdose years ago', 'I attempted suicide in 2010', 'I attempted suicide when I was 16',
  'I attempted suicide once', 'I drank some bleach by accident', 'he busted my phone', "he's holding me hostage with his addiction", 'my husband of 20 years left me',
  'i have no reason to live with him', 'no estoy suicida', 'no me hice daño a propósito', 'I was in a rush, comin home from work', 'the kids were goin to school',
  'im killin myself here', 'Takin my son to rehab tomorrow',
];
Deno.test('round 13: dropped g, "of 20 years", "the father of my kids", injuries, hostage; and the new self-harm forms', () => {
  for (const text of R13_ABUSE) assertEquals([text, crisisKind(text)], [text, 'abuse']);
  for (const text of R13_SELF_HARM) assertEquals([text, crisisKind(text)], [text, 'self_harm']);
  for (const text of R13_NULL) assertEquals([text, crisisKind(text)], [text, null]);
});

Deno.test('round 13: the backstop strips more words to the app, and hears vocatives and "usted" as words to him', () => {
  const violence = { results: [{ categories: { violence: true } }] };
  const on = { violence: true };
  for (const text of [
    'can you call 911 my sons hitting me', 'is this real? are you a person? my husbands choking me', 'i know you are just an app but my sons hitting me',
    'sorry to bother you, me pegó mi esposo', 'can you call someone, me golpeo mi hijo', 'perdón por molestarte, mi esposo me está pegando',
    'sé que eres una app pero mi hijo me está pegando', '¿puedes llamar al 911? mi esposo me está golpeando',
  ]) assertEquals([text, moderationCrisisKind(violence, text, on)], [text, 'abuse']);
  for (const text of [
    'I was hit, and I am not okay with pretending it never happened.', 'The night the bottle hit me, I decided this has to change.',
    'Mom, Dad hurt me again and I need us to talk about it.', 'Papá, ya no me pegue, por favor.', 'Mijo, no me empuje.',
    'I got hurt the last time and I still have the scar.', 'My face still has the bruise from Saturday, son.',
    'I was choked by the person I love most. That is why I am here.', 'Me empujaron, me insultaron, y aquí sigo amándote.',
  ]) assertEquals([text, moderationCrisisKind(violence, text, on)], [text, null]);
});
