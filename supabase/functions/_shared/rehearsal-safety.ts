// Deterministic backstop for the model's safety override: first-person crisis
// disclosures (the USER in danger, not the character they are practicing with)
// always break character, even if the model stays in role or mis-formats the
// break token. Deliberately first-person so practicing a conversation ABOUT a
// loved one's past attempt does not trip it.
//
// "Don't want to live / be here" only counts at the end of a clause: family
// members routinely rehearse "I don't want to live like this anymore" about
// the addiction, and that must not stop the practice.
const CLAUSE_END = String.raw`\s*(?:[.!?,;…]|$)`;

const USER_CRISIS_PATTERNS = [
  /\b(kill|killing|hurt|hurting|harm|harming|cut|cutting) myself\b/i,
  /\bend(ing)? my (own )?life\b/i,
  /\bi (want|wanna|am going|'m going|plan) to die\b/i,
  new RegExp(String.raw`\bi (?:don't|do not|dont|don’t) want to (?:live|be alive|be here)(?: anymore)?` + CLAUSE_END, 'i'),
  /\bi('m| am|’m) (feeling )?suicidal\b/i,
  /\b(he|she|they)('s| is| are|’s) (hitting|beating|choking|strangling) me\b/i,
  /(?:^|[^\p{L}])(?:matarme|suicidarme|quitarme la vida|hacerme da[ñn]o)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(?:quiero|voy a) morir(?:me)?(?![\p{L}])/iu,
  new RegExp(String.raw`(?:^|[^\p{L}])no quiero (?:vivir|seguir viviendo|estar aqu[íi])(?: m[áa]s)?` + CLAUSE_END, 'iu'),
  /(?:^|[^\p{L}])me est[áa]n? (?:pegando|golpeando|ahorcando)(?![\p{L}])/iu,
];

export function userInCrisis(text: string): boolean {
  return USER_CRISIS_PATTERNS.some((re) => re.test(text));
}

export const CRISIS_BREAK_TEXT: Record<'en' | 'es', string> = {
  en: "Let's pause the practice. What you just shared matters more than any rehearsal — please reach out for real support right now: call or text 988, or call 911 if you're in danger.",
  es: 'Pausemos la práctica. Lo que acabas de compartir importa más que cualquier ensayo — busca apoyo real ahora mismo: llama o envía un mensaje al 988, o llama al 911 si estás en peligro.',
};

export type Debrief = {
  wentWell: string[];
  workOn: string[];
  drill: string;
  scores: { love: number; ask: number; boundaries: number; calm: number };
};

// The model's JSON is untrusted: coerce it to exactly the shape the app renders
// (and stores in history) so a malformed field can never crash the debrief.
export function normalizeDebrief(raw: unknown): Debrief | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim().slice(0, 700))
      .slice(0, max);
  const score = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN;
    return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
  };
  const sc = (r.scores && typeof r.scores === 'object' ? r.scores : {}) as Record<string, unknown>;
  const wentWell = strings(r.wentWell, 3);
  const workOn = strings(r.workOn, 2);
  if (wentWell.length === 0 && workOn.length === 0) return null;
  return {
    wentWell,
    workOn,
    drill: typeof r.drill === 'string' ? r.drill.trim().slice(0, 700) : '',
    scores: { love: score(sc.love), ask: score(sc.ask), boundaries: score(sc.boundaries), calm: score(sc.calm) },
  };
}
