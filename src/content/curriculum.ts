import type { CurriculumPiece, CurriculumPhase, SituationBandInput } from '../api/types';

/**
 * Versioned family-curriculum content.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Today feed previously rotated focus content with `dayOfYear % 7`, so a
 * family on day 200 saw the same card they saw on day 60. Check-in habit is
 * the win of that design; progression was missing. This library adds an
 * *advancing* weekly teaching arc on top of the daily loop — the family moves
 * through a curriculum instead of looping a pool.
 *
 * SHAPE
 * -----
 * Two parallel libraries (English + Spanish) share ids, phases, week numbers,
 * and colors, exactly like `scripts.ts`. Selection keys off ids, so language
 * switching is seamless and no piece can drift between locales.
 *
 * Each piece carries:
 *  - mechanism: WHY this is happening. Named and normalized, never shamed.
 *  - practice:  one concrete thing to do this week. Small enough to actually do.
 *  - prompt:    one question worth sitting with. Not homework.
 *  - crisisSafe: whether this piece is appropriate to surface while the
 *    family's situation band is `elevated` or `crisis`. Teaching content that
 *    asks for reflection is wrong for someone whose week is on fire — those
 *    families get the support-forward subset only.
 *
 * PHASES
 * ------
 * Phase is derived from weeks-since-join, NOT from the loved one's level of
 * care. The family's arc runs on its own clock: a family whose son is still
 * using and a family whose son is 60 days into residential can both be in
 * week 3 of their own recovery, and they need the same thing in week 3.
 *
 *  orientation      w1–2   Stop the bleeding. You are not crazy, and not alone.
 *  stabilizing      w3–5   Boundaries as protection, not punishment.
 *  family_recovery  w6–8   The pivot: your recovery is not contingent on theirs.
 *  durability       w9+    (reserved — pieces land in the next batch)
 *
 * COVERAGE
 * --------
 * This batch is weeks 1–8, authored for voice review before the remaining 44
 * are written. `selectCurriculumPiece` clamps past the end of the authored
 * range, so shipping a partial library is safe: a family in week 12 sees the
 * last authored piece for their phase rather than nothing.
 */

// ─── Phase model ──────────────────────────────────────────────────────────────

/** Inclusive week bounds per phase. `endWeek: null` = open-ended tail. */
export const PHASE_WEEKS: Record<CurriculumPhase, { startWeek: number; endWeek: number | null }> = {
  orientation: { startWeek: 1, endWeek: 2 },
  stabilizing: { startWeek: 3, endWeek: 5 },
  family_recovery: { startWeek: 6, endWeek: 8 },
  durability: { startWeek: 9, endWeek: null },
};

/** Display order — also the progression order. */
export const PHASE_ORDER: CurriculumPhase[] = [
  'orientation',
  'stabilizing',
  'family_recovery',
  'durability',
];

/** i18n keys (namespace `today`) for phase chrome. */
export const PHASE_LABEL_KEY: Record<CurriculumPhase, string> = {
  orientation: 'curriculum.phase.orientation',
  stabilizing: 'curriculum.phase.stabilizing',
  family_recovery: 'curriculum.phase.familyRecovery',
  durability: 'curriculum.phase.durability',
};

// ─── English library ──────────────────────────────────────────────────────────

export const CURRICULUM: CurriculumPiece[] = [
  // ── Phase 1 — Orientation (weeks 1–2) ──
  {
    id: 'cur-w01-not-crazy',
    week: 1,
    phase: 'orientation',
    tag: 'START HERE',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🧭',
    accentColor: '#e8eef6',
    title: "You're not crazy, and you're not imagining it",
    mechanism:
      "By the time a family reaches out, most have spent months being told — sometimes by the person using, sometimes by each other — that they're overreacting. So you've learned to second-guess what you can plainly see. That doubt isn't a character flaw. It's what happens when someone's survival depends on you not trusting your own eyes. Addiction protects itself, and the first thing it goes after is your certainty. If you've been keeping a mental list of things that didn't add up, that list is data, not paranoia.",
    practice:
      'Write down three specific things you have seen with your own eyes in the last month. Not conclusions — observations. "Forty dollars gone from my wallet on the 14th." "Slept until 3pm on a workday, twice." Keep the list where only you can find it.',
    prompt: "What have you stopped saying out loud because of how it went the last time you said it?",
    crisisSafe: true,
  },
  {
    id: 'cur-w02-not-your-fault',
    week: 2,
    phase: 'orientation',
    tag: 'START HERE',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🪨',
    accentColor: '#e8eef6',
    title: "The search for the thing you did wrong",
    mechanism:
      "Nearly every family runs the tape backward looking for the moment it turned — the divorce, the move, the surgery with the pills, the thing you said in 2019. That search feels like responsibility, but it's mostly a way to make something unbearable make sense. If you caused it, then you can fix it, and fixing it is more tolerable than sitting with something you cannot control. Here's the harder and better truth: you didn't cause it, you can't cure it, and you can still change the conditions around it. Those three facts fit together. Most families only ever hear the first two.",
    practice:
      "Say this out loud, once, alone: \"I didn't cause this, and there's still something for me to do.\" Notice which half of that sentence you resist. That's the half worth paying attention to.",
    prompt: 'If you knew for certain none of this was your fault, what would you stop doing this week?',
    crisisSafe: true,
  },

  // ── Phase 2 — Stabilizing (weeks 3–5) ──
  {
    id: 'cur-w03-protection-not-punishment',
    week: 3,
    phase: 'stabilizing',
    tag: 'BOUNDARIES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🛡️',
    accentColor: '#fdf3e3',
    title: 'A boundary is a wall around you, not a punishment for them',
    mechanism:
      "Most families set their first boundary as a consequence — a thing done TO the person, designed to produce a change in them. Those collapse, because when the person doesn't change, the boundary looks like it failed, so you drop it. A boundary that holds is built differently: it protects you and it's true whether or not they ever change. \"I don't give cash\" holds on their worst day and their best day. \"You can't come in when you're using\" protects your house. Neither one requires their cooperation, which is exactly why neither one can be argued with.",
    practice:
      'Take one boundary you have already tried and failed to hold. Rewrite it as a sentence about you, starting with "I." If it still needs them to do something for it to be true, it will break again. Rewrite it once more.',
    prompt: 'Which of your current limits would you have to abandon if they never got sober?',
    crisisSafe: true,
  },
  {
    id: 'cur-w04-help-vs-cushion',
    week: 4,
    phase: 'stabilizing',
    tag: 'BOUNDARIES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '⚖️',
    accentColor: '#fdf3e3',
    title: 'Help protects the person. Cushioning protects the addiction.',
    mechanism:
      "The word \"enabling\" has been used as an accusation for so long that it's nearly useless — it makes people defensive when they most need to be curious. Try a cleaner test instead: does this action protect the person, or does it protect the addiction from its own consequences? Groceries, a ride to a meeting, paying a treatment center directly — those protect the person. Paying the debt, calling their boss, smoothing over what happened at dinner — those absorb an impact that was supposed to land. The action can look identical from the outside. The difference is which one you're shielding. And notice: cushioning almost always comes from love. That's what makes it so hard to see and so hard to stop.",
    practice:
      'Pick the single thing you did last week that you already suspect was cushioning. Just name it to yourself, in one sentence, without arguing your case. Do not change it yet. Seeing it clearly comes first.',
    prompt: 'What would have happened last month if you had not stepped in? Be specific — the real answer, not the catastrophic one.',
    crisisSafe: true,
  },
  {
    id: 'cur-w05-consistency',
    week: 5,
    phase: 'stabilizing',
    tag: 'BOUNDARIES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🧱',
    accentColor: '#fdf3e3',
    title: 'One limit you keep beats ten you announce',
    mechanism:
      "Families in crisis tend to declare a lot of new rules at once, usually after a bad night. Then the week gets long, someone is exhausted, three of the ten quietly lapse — and the person using learns something specific: the limits are weather, not walls. Wait long enough and they pass. This is why consistency matters more than severity. A single small boundary that never moves teaches more than a dramatic one that moves under pressure. It's also why you should set fewer than you want to. Pick the one you can hold on a Tuesday when you're worn out and no one is watching.",
    practice:
      'Choose one limit and hold only that one for seven days. Write it down. If you catch yourself wanting to add a second, resist it — the goal this week is not coverage, it is a limit that proves it does not move.',
    prompt: 'Which of your boundaries would they tell you is negotiable? They usually know before you do.',
    crisisSafe: false,
  },

  // ── Phase 3 — Family recovery (weeks 6–8) ──
  {
    id: 'cur-w06-both-self-medicating',
    week: 6,
    phase: 'family_recovery',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🔄',
    accentColor: '#e9f2ec',
    title: "You've been self-medicating too",
    mechanism:
      "This one lands hard, and it isn't an accusation. They use a substance to manage what they can't tolerate feeling. You've been using control — the monitoring, the phone checks, the mental math about how much is left in the bottle, the constant low-grade scanning. Both are ways to not feel something unbearable. Both work in the short term. Both cost more over time than they return. That's why \"just let go\" never works as advice: you'd be asking someone to drop their coping strategy with nothing to replace it, which is precisely what we don't ask of the person in treatment either. Two people in one house, both medicating, neither one at fault, both in something they can step out of.",
    practice:
      'Notice one time this week when you reached for control the way someone else reaches for a drink — and let that moment pass without acting on it. Once. Not to prove anything. Just to find out that you can.',
    prompt: 'If the monitoring stopped tomorrow, what feeling would show up first?',
    crisisSafe: true,
  },
  {
    id: 'cur-w07-your-own-support',
    week: 7,
    phase: 'family_recovery',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🤝',
    accentColor: '#e9f2ec',
    title: 'They get a treatment team. Who do you get?',
    mechanism:
      "When someone goes to treatment they're handed a counselor, a group, a schedule, and a room full of people who understand. The family gets a visiting day. So the imbalance is structural, not personal — and it's why families so often come apart at exactly the moment things start going right. You've been running on adrenaline; adrenaline holds until the emergency ends, and then it stops holding. Your recovery is not a reward you collect after theirs is secure. Run them in parallel or you will be the one who breaks next.",
    practice:
      'Tell one person outside your household one true sentence about how you are actually doing. Not the update on your loved one — how *you* are. One person, one sentence, this week.',
    prompt: 'Who is the last person who asked how you were and actually waited for the answer?',
    crisisSafe: true,
  },
  {
    id: 'cur-w08-anxiety-when-improving',
    week: 8,
    phase: 'family_recovery',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🌤️',
    accentColor: '#e9f2ec',
    title: 'Why you feel worse when things start going better',
    mechanism:
      "Families expect relief when the person finally gets help. What often arrives instead is a spike in anxiety, and it blindsides them. The mechanism is straightforward: vigilance built over years doesn't stand down because someone got thirty days. Your nervous system learned that dropping your guard is when the disaster hits, so calm now reads as the moment before impact. On top of that, the crisis was doing something for you — it organized your days and told you what mattered. When it lifts, the grief and the exhaustion you postponed finally have room to land. Feeling worse right now is not a sign this is failing. It's frequently the first honest sign that it's working.",
    practice:
      "Say the scared thing out loud to one other adult — not to your loved one. \"I'm afraid this is temporary.\" It doesn't need a solution attached. It needs to stop being carried silently.",
    prompt: 'What are you specifically watching for? Naming it usually shrinks it.',
    crisisSafe: true,
  },
];

// ─── Spanish library ──────────────────────────────────────────────────────────
// Same ids, weeks, phases, and colors. Selection keys off ids only.

export const CURRICULUM_ES: CurriculumPiece[] = [
  {
    id: 'cur-w01-not-crazy',
    week: 1,
    phase: 'orientation',
    tag: 'EMPIEZA AQUÍ',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🧭',
    accentColor: '#e8eef6',
    title: 'No estás loco, y no te lo estás imaginando',
    mechanism:
      'Cuando una familia por fin pide ayuda, casi siempre lleva meses escuchando —a veces de la persona que consume, a veces entre ustedes mismos— que está exagerando. Así que aprendiste a dudar de lo que ves con claridad. Esa duda no es un defecto tuyo. Es lo que pasa cuando la supervivencia de alguien depende de que no confíes en tus propios ojos. La adicción se protege, y lo primero que ataca es tu certeza. Si has llevado una lista mental de cosas que no cuadraban, esa lista es información, no paranoia.',
    practice:
      'Escribe tres cosas concretas que hayas visto con tus propios ojos en el último mes. No conclusiones: observaciones. "Faltaban cuarenta dólares de mi cartera el día 14." "Durmió hasta las 3 de la tarde en día laboral, dos veces." Guarda la lista donde solo tú puedas encontrarla.',
    prompt: '¿Qué dejaste de decir en voz alta por cómo terminó la última vez que lo dijiste?',
    crisisSafe: true,
  },
  {
    id: 'cur-w02-not-your-fault',
    week: 2,
    phase: 'orientation',
    tag: 'EMPIEZA AQUÍ',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🪨',
    accentColor: '#e8eef6',
    title: 'La búsqueda de lo que hiciste mal',
    mechanism:
      'Casi toda familia rebobina la cinta buscando el momento en que todo cambió: el divorcio, la mudanza, la cirugía con las pastillas, algo que dijiste en 2019. Esa búsqueda se siente como responsabilidad, pero sobre todo es una manera de darle sentido a algo insoportable. Si tú lo causaste, entonces puedes arreglarlo, y arreglarlo es más tolerable que aceptar algo que no controlas. La verdad más difícil y más útil es esta: no lo causaste, no puedes curarlo, y aun así puedes cambiar las condiciones a su alrededor. Las tres cosas son compatibles. A la mayoría de las familias solo les dicen las dos primeras.',
    practice:
      'Di esto en voz alta, una vez, a solas: "No causé esto, y todavía hay algo que me toca hacer." Fíjate cuál mitad de la frase rechazas. Esa es la mitad que vale la pena mirar.',
    prompt: 'Si supieras con certeza que nada de esto es culpa tuya, ¿qué dejarías de hacer esta semana?',
    crisisSafe: true,
  },
  {
    id: 'cur-w03-protection-not-punishment',
    week: 3,
    phase: 'stabilizing',
    tag: 'LÍMITES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🛡️',
    accentColor: '#fdf3e3',
    title: 'Un límite es un muro alrededor de ti, no un castigo para ellos',
    mechanism:
      'Casi todas las familias ponen su primer límite como consecuencia: algo que se le hace A la persona para provocar un cambio en ella. Esos límites se derrumban, porque cuando la persona no cambia, el límite parece haber fallado y entonces lo abandonas. Un límite que se sostiene está construido de otra forma: te protege a ti y es verdad aunque la otra persona nunca cambie. "No doy dinero en efectivo" se sostiene en su peor día y en su mejor día. "No puedes entrar si estás consumiendo" protege tu casa. Ninguno de los dos requiere su cooperación, y por eso mismo ninguno se puede discutir.',
    practice:
      'Toma un límite que ya intentaste sostener y no pudiste. Reescríbelo como una frase sobre ti, empezando con "Yo". Si todavía necesita que ellos hagan algo para ser verdad, se va a volver a romper. Reescríbelo otra vez.',
    prompt: '¿Cuál de tus límites actuales tendrías que abandonar si esa persona nunca lograra la sobriedad?',
    crisisSafe: true,
  },
  {
    id: 'cur-w04-help-vs-cushion',
    week: 4,
    phase: 'stabilizing',
    tag: 'LÍMITES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '⚖️',
    accentColor: '#fdf3e3',
    title: 'Ayudar protege a la persona. Amortiguar protege a la adicción.',
    mechanism:
      'La palabra "facilitar" se ha usado como acusación durante tanto tiempo que ya casi no sirve: pone a la gente a la defensiva justo cuando más necesita tener curiosidad. Prueba una pregunta más limpia: ¿esta acción protege a la persona, o protege a la adicción de sus propias consecuencias? Comida, llevarla a una reunión, pagarle directamente al centro de tratamiento: eso protege a la persona. Pagar la deuda, llamar a su jefe, disimular lo que pasó en la cena: eso absorbe un golpe que debía aterrizar. Por fuera la acción puede verse idéntica. La diferencia es a quién estás protegiendo. Y ojo: amortiguar casi siempre nace del amor. Por eso cuesta tanto verlo y cuesta tanto dejarlo.',
    practice:
      'Elige la única cosa que hiciste la semana pasada que ya sospechas que fue amortiguar. Solo nómbrala para ti, en una frase, sin defenderte. No la cambies todavía. Primero hay que verla con claridad.',
    prompt: '¿Qué habría pasado el mes pasado si no hubieras intervenido? Sé específico: la respuesta real, no la catastrófica.',
    crisisSafe: true,
  },
  {
    id: 'cur-w05-consistency',
    week: 5,
    phase: 'stabilizing',
    tag: 'LÍMITES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🧱',
    accentColor: '#fdf3e3',
    title: 'Un límite que cumples vale más que diez que anuncias',
    mechanism:
      'Las familias en crisis suelen declarar muchas reglas nuevas de golpe, casi siempre después de una mala noche. Después la semana se hace larga, alguien está agotado, tres de las diez se caen en silencio, y la persona que consume aprende algo muy concreto: los límites son clima, no muros. Si espera lo suficiente, pasan. Por eso la constancia importa más que la severidad. Un límite pequeño que nunca se mueve enseña más que uno dramático que cede bajo presión. Y por eso conviene poner menos de los que quisieras. Elige el que puedas sostener un martes, cansado, cuando nadie te está mirando.',
    practice:
      'Elige un solo límite y sostén únicamente ese durante siete días. Escríbelo. Si te descubres queriendo agregar un segundo, resístelo: la meta de esta semana no es cubrir todo, es un límite que demuestre que no se mueve.',
    prompt: '¿Cuál de tus límites te diría esa persona que es negociable? Casi siempre lo saben antes que tú.',
    crisisSafe: false,
  },
  {
    id: 'cur-w06-both-self-medicating',
    week: 6,
    phase: 'family_recovery',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🔄',
    accentColor: '#e9f2ec',
    title: 'Tú también te has estado automedicando',
    mechanism:
      'Esta cuesta escucharla, y no es una acusación. La otra persona usa una sustancia para manejar lo que no tolera sentir. Tú has usado el control: la vigilancia, revisar el teléfono, calcular mentalmente cuánto queda en la botella, ese escaneo constante de fondo. Las dos cosas sirven para no sentir algo insoportable. Las dos funcionan a corto plazo. Las dos cuestan con el tiempo más de lo que devuelven. Por eso "suéltalo" nunca funciona como consejo: le estarías pidiendo a alguien que abandone su estrategia para sobrevivir sin nada que la reemplace, que es justo lo que tampoco le pedimos a quien está en tratamiento. Dos personas en una casa, ambas automedicándose, ninguna culpable, ambas en algo de lo que se puede salir.',
    practice:
      'Nota una vez esta semana en que buscaste el control como otra persona busca un trago, y deja pasar ese momento sin actuar. Una vez. No para demostrar nada. Solo para descubrir que puedes.',
    prompt: 'Si la vigilancia se detuviera mañana, ¿qué sentimiento aparecería primero?',
    crisisSafe: true,
  },
  {
    id: 'cur-w07-your-own-support',
    week: 7,
    phase: 'family_recovery',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🤝',
    accentColor: '#e9f2ec',
    title: 'Ellos reciben un equipo de tratamiento. ¿Quién te toca a ti?',
    mechanism:
      'Cuando alguien entra a tratamiento le asignan un consejero, un grupo, un horario y una sala llena de gente que entiende. A la familia le dan un día de visita. El desequilibrio es estructural, no personal, y explica por qué tantas familias se quiebran justo cuando las cosas empiezan a ir bien. Has estado funcionando con adrenalina; la adrenalina aguanta hasta que termina la emergencia, y entonces deja de aguantar. Tu recuperación no es un premio que recoges cuando la de ellos ya esté asegurada. Va en paralelo, o el próximo en romperse vas a ser tú.',
    practice:
      'Dile a una persona fuera de tu casa una frase verdadera sobre cómo estás realmente. No el reporte sobre tu ser querido: cómo estás *tú*. Una persona, una frase, esta semana.',
    prompt: '¿Quién fue la última persona que te preguntó cómo estabas y de verdad esperó la respuesta?',
    crisisSafe: true,
  },
  {
    id: 'cur-w08-anxiety-when-improving',
    week: 8,
    phase: 'family_recovery',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🌤️',
    accentColor: '#e9f2ec',
    title: 'Por qué te sientes peor cuando las cosas empiezan a mejorar',
    mechanism:
      'Las familias esperan alivio cuando la persona finalmente recibe ayuda. Lo que suele llegar es un aumento de la ansiedad, y las toma por sorpresa. El mecanismo es sencillo: una vigilancia construida durante años no se desactiva porque alguien cumpla treinta días. Tu sistema nervioso aprendió que bajar la guardia es justo cuando golpea el desastre, así que ahora la calma se lee como el momento antes del impacto. Además, la crisis cumplía una función: organizaba tus días y te decía qué importaba. Cuando se levanta, el duelo y el agotamiento que postergaste por fin tienen espacio para aterrizar. Sentirte peor ahora no es señal de que esto está fracasando. Muchas veces es la primera señal honesta de que está funcionando.',
    practice:
      'Di el miedo en voz alta a otro adulto, no a tu ser querido. "Tengo miedo de que esto sea temporal." No necesita solución. Necesita dejar de cargarse en silencio.',
    prompt: '¿Qué estás vigilando exactamente? Nombrarlo casi siempre lo encoge.',
    crisisSafe: true,
  },
];

// ─── Selection ────────────────────────────────────────────────────────────────

function libraryFor(language?: string): CurriculumPiece[] {
  return language?.startsWith('es') ? CURRICULUM_ES : CURRICULUM;
}

/** Full library for the active language (browse / admin preview). */
export function getCurriculum(language?: string): CurriculumPiece[] {
  return libraryFor(language);
}

/**
 * Week number since the family joined, 1-based.
 * Week 1 = days 1–7. Returns 1 for a null/unparseable joinedAt so a brand-new
 * or partially-synced account still gets week 1 rather than nothing.
 */
export function curriculumWeek(joinedAt: string | null, now: Date = new Date()): number {
  if (!joinedAt) return 1;
  const start = new Date(joinedAt);
  if (Number.isNaN(start.getTime())) return 1;
  const days = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

/** Phase for a given week number. */
export function phaseForWeek(week: number): CurriculumPhase {
  for (const phase of PHASE_ORDER) {
    const { startWeek, endWeek } = PHASE_WEEKS[phase];
    if (week >= startWeek && (endWeek === null || week <= endWeek)) return phase;
  }
  return 'orientation';
}

/**
 * The piece to surface for a family this week.
 *
 * Rules, in order:
 *  1. Exact week match wins — the arc is the point.
 *  2. Past the authored range, hold at the highest authored week rather than
 *     returning null. A partial library must never produce an empty card.
 *  3. When the situation band is `elevated` or `crisis`, only `crisisSafe`
 *     pieces are eligible. A family whose week is on fire should not be handed
 *     a reflection exercise; if nothing safe is available we return null and
 *     the caller falls back to the support-forward surface.
 *
 * Returns null only when the library has no eligible piece at all.
 */
export function selectCurriculumPiece(
  week: number,
  band: SituationBandInput,
  language?: string,
): CurriculumPiece | null {
  const library = libraryFor(language);
  if (library.length === 0) return null;

  const guarded = band === 'elevated' || band === 'crisis';
  const eligible = guarded ? library.filter((piece) => piece.crisisSafe) : library;
  if (eligible.length === 0) return null;

  const exact = eligible.find((piece) => piece.week === week);
  if (exact) return exact;

  // Before the first authored week (defensive — week is always >= 1).
  const earliest = eligible.reduce((a, b) => (a.week <= b.week ? a : b));
  if (week < earliest.week) return earliest;

  // Past the authored range: hold at the latest eligible piece at or below the
  // requested week, else the latest overall.
  const atOrBelow = eligible.filter((piece) => piece.week <= week);
  if (atOrBelow.length > 0) {
    return atOrBelow.reduce((a, b) => (a.week >= b.week ? a : b));
  }
  return eligible.reduce((a, b) => (a.week >= b.week ? a : b));
}

/** True once the family has passed the last authored week (content backlog signal). */
export function isBeyondAuthoredCurriculum(week: number, language?: string): boolean {
  const library = libraryFor(language);
  if (library.length === 0) return true;
  const maxWeek = library.reduce((max, piece) => Math.max(max, piece.week), 0);
  return week > maxWeek;
}
