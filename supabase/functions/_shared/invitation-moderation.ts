// Invitation Engine — a second opinion on Personalize, after the patterns.
// One call to OpenAI's free moderation endpoint with every screened text as
// its own input (so each verdict is judged against its own words), bounded
// and time-limited; any failure (no key, network, error) falls back to the
// patterns alone. Like a pattern hit, a flag shows her the crisis resources
// first and can then be set aside by her "I'm safe right now".

export const INVITATION_MODERATION_MAX_CHARS = 8_000;
export const INVITATION_MODERATION_TIMEOUT_MS = 3_000;

// A moderation violence verdict counts as a hit UNLESS the text is clearly
// property-only: it names an object as the target (wall, door, phone, a hole…)
// and nothing in it points at a person — no me/us/her, no "my face", no
// "a mí"/"nos", no family member or pet. A false positive is cheap (she can
// say "I'm safe right now"); a missed assault is not, so anything else —
// "He burned me with a cigarette", "Me tiró al suelo", even "My husband got
// into a fight at the bar" — is a hit. Checked per text, never across fields.
const OBJECT_EN = /\b(?:walls?|doors?|windows?|tables?|chairs?|cars?|trucks?|tvs?|televisions?|phones?|cellphones?|laptops?|computers?|furniture|holes?|mirrors?|cabinets?|dishes|plates?|dressers?|fridge|refrigerator|lamps?|dashboard|windshield|counters?)\b/i;
const OBJECT_ES = /(?:^|[^\p{L}])(?:pared(?:es)?|puertas?|ventanas?|mesas?|sillas?|carros?|coches?|camionetas?|tele|televisi[óo]n|televisor(?:es)?|tel[ée]fonos?|celular(?:es)?|computadoras?|muebles?|espejos?|hoyos?|agujeros?|platos?|gabinetes?|caj[óo]n(?:es)?|refrigerador|parabrisas)(?![\p{L}])/iu;
const BODY = String.raw`(?:neck|face|head|arms?|hands?|legs?|throat|ribs?|nose|jaw|eyes?|chest|back|wrists?|hair|stomach|body|cuello|cara|cabeza|brazos?|manos?|piernas?|garganta|costillas?|nariz|mand[íi]bula|ojos?|pecho|espalda|mu[ñn]ecas?|pelo|cabello|est[óo]mago|cuerpo)`;
const PEOPLE = String.raw`(?:kids?|children|child|(?:my|our|his|her|their|the|a)\s+sons?|daughters?|baby|babies|husband|wife|partner|mom|mother|dad|father|sisters?|brothers?|grandkids?|family|dog|cat|pets?|puppy|someone|somebody|anyone|people|guy|man|woman|neighbou?rs?|friends?|girlfriend|boyfriend|hij[oa]s?|ni[ñn][oa]s?|beb[ée]s?|nietos?|nietas?|espos[oa]|pareja|mam[áa]|madre|pap[áa]|padre|herman[oa]s?|familia|perros?|gatos?|mascotas?|alguien|gente|vecin[oa]s?|amig[oa]s?|novi[oa])`;
// "My son …", "Mi hijo …", "He …", "Él …" opening a clause is who did it,
// not a target ("Last night my son punched the wall", "Anoche mi hijo…").
const FAMILY_SUBJECT = String.raw`(?:son|husband|wife|partner|daughter|brother|sister|dad|father|boyfriend|hij[oa]|espos[oa]|pareja|herman[oa]|pap[áa]|padre|novi[oa])`;
const CLAUSE_SUBJECT = new RegExp(
  String.raw`(^|[.,;:!?]\s*|(?:^|\s)(?:then|and|so|last night|yesterday|today|tonight|this morning|anoche|ayer|hoy|y|luego|entonces|esta ma[ñn]ana)\s+)\s*(?:(?:my|our|mi|nuestr[oa])\s+(?:\p{L}+\s+)?${FAMILY_SUBJECT}|he|she|they|[ée]l|ella|ellos)(?![\p{L}])`,
  'giu',
);
const PERSON_TARGET: readonly RegExp[] = [
  /\b(?:me|us|myself|ourselves|her|herself|him|himself|them|you)\b/i,
  /\b(?:I|we)\s+(?:was|were|got|am|are|have been|had been|ended up)\b/i,
  new RegExp(String.raw`(?:^|[^\p{L}])(?:my|our|mi|mis|nuestr[oa]s?)\s+${BODY}(?![\p{L}])`, 'iu'),
  new RegExp(String.raw`(?:^|[^\p{L}])${PEOPLE}(?![\p{L}])`, 'iu'),
  /(?:^|[^\p{L}])(?:me|nos|conmigo)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(?:a|contra|hacia)\s+(?:m[íi]|nosotr[oa]s|ella|[ée]l|ellos|ellas)(?![\p{L}])/iu,
  // Enclitic objects: "golpearme", "tirándonos".
  /\p{L}+(?:ar|er|ir|[aá]ndo|i[ée]ndo)(?:me|nos)(?![\p{L}])/iu,
];

/**
 * Violence aimed only at an object ("My son punched a hole in the wall",
 * "Mi hijo le dio un puñetazo a la pared") — the one case a moderation
 * violence verdict is set aside.
 */
export function propertyOnlyViolence(text: string): boolean {
  if (!OBJECT_EN.test(text) && !OBJECT_ES.test(text)) return false;
  const rest = text.replace(CLAUSE_SUBJECT, '$1 ');
  return !PERSON_TARGET.some((pattern) => pattern.test(rest));
}

/**
 * One moderation result for one text: self-harm intent or instructions (or
 * self-harm with some intent signal), or violence/threatening harassment
 * unless this same text is clearly property-only.
 */
export function moderationResultFlags(result: unknown, text: string): boolean {
  const categories = (result as { categories?: Record<string, unknown> })?.categories ?? {};
  const scores = (result as { category_scores?: Record<string, unknown> })?.category_scores ?? {};
  const intent = typeof scores['self-harm/intent'] === 'number' ? scores['self-harm/intent'] as number : 0;
  const selfHarm = categories['self-harm/intent'] === true
    || categories['self-harm/instructions'] === true
    || (categories['self-harm'] === true && intent >= 0.2);
  const violence = categories['violence'] === true || categories['harassment/threatening'] === true;
  return selfHarm || (violence && !propertyOnlyViolence(text));
}

/** Index (into `texts`) of the first flagged result, or -1. results[i] belongs to texts[i]. */
export function flaggedModerationIndex(data: unknown, texts: readonly string[]): number {
  const results = (data as { results?: unknown })?.results;
  if (!Array.isArray(results)) return -1;
  for (let i = 0; i < Math.min(results.length, texts.length); i += 1) {
    if (moderationResultFlags(results[i], texts[i])) return i;
  }
  return -1;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The non-empty texts that fit the budget, each remembering its original index. */
function boundedInputs(texts: readonly string[]): Array<{ index: number; text: string }> {
  const out: Array<{ index: number; text: string }> = [];
  let budget = INVITATION_MODERATION_MAX_CHARS;
  texts.forEach((raw, index) => {
    const text = raw.trim();
    if (!text || budget <= 0) return;
    const clipped = text.slice(0, budget);
    out.push({ index, text: clipped });
    budget -= clipped.length;
  });
  return out;
}

/**
 * Index (into `texts`) of the first text moderation flags, or -1. One call,
 * with every text as its own input. Fails open (-1) on anything else.
 */
export async function moderateInvitationTexts(
  texts: readonly string[],
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
  timeoutMs = INVITATION_MODERATION_TIMEOUT_MS,
): Promise<number> {
  const inputs = boundedInputs(texts);
  if (!inputs.length || !apiKey) return -1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: inputs.map((item) => item.text) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('invitation_moderation_error', res.status);
      await res.body?.cancel();
      return -1;
    }
    const hit = flaggedModerationIndex(await res.json(), inputs.map((item) => item.text));
    return hit < 0 ? -1 : inputs[hit].index;
  } catch {
    console.error('invitation_moderation_unavailable');
    return -1;
  } finally {
    clearTimeout(timer);
  }
}

/** Boolean form of moderateInvitationTexts. */
export async function moderateInvitationText(
  texts: readonly string[],
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
  timeoutMs = INVITATION_MODERATION_TIMEOUT_MS,
): Promise<boolean> {
  return (await moderateInvitationTexts(texts, apiKey, fetchImpl, timeoutMs)) >= 0;
}

export type InvitationCrisisHit<F extends string> = { field: F; source: 'patterns' | 'moderation' };

/**
 * Which fields invitation-coach screens. Without her "I'm safe right now":
 * all of them. With it: only the texts she types in the kit (observation,
 * next step) that differ from what was on screen when she tapped it — her
 * acknowledgement covers the hits she saw, never words typed afterwards.
 * An unchanged observation that was itself the hit stays acknowledged.
 */
export function fieldsToScreen<F extends string>(
  all: readonly F[],
  acknowledged: boolean,
  typed: ReadonlyArray<{ field: F; current: string; acknowledgedText: string }>,
): F[] {
  if (!acknowledged) return [...all];
  const changed = new Set(typed.filter((item) => item.current.trim() !== item.acknowledgedText.trim()).map((item) => item.field));
  return all.filter((field) => changed.has(field));
}

/**
 * invitation-coach's crisis decision over the fields in `screen`, in order:
 * a pattern hit, then one moderation call over those fields' texts. Nothing
 * to screen (her acknowledgement covers everything) means no call at all.
 * Returns the hit to answer 409 with, or null to go on.
 */
export async function invitationCrisisGate<F extends string>(options: {
  screen: readonly F[];
  texts: ReadonlyArray<{ field: F; text: string }>;
  patternField: (screen: readonly F[]) => F | null;
  moderate: (texts: readonly string[]) => Promise<number>;
}): Promise<InvitationCrisisHit<F> | null> {
  if (!options.screen.length) return null;
  const pattern = options.patternField(options.screen);
  if (pattern) return { field: pattern, source: 'patterns' };
  const scoped = options.texts.filter((item) => options.screen.includes(item.field));
  if (!scoped.length) return null;
  const flagged = await options.moderate(scoped.map((item) => item.text));
  const hit = flagged >= 0 ? scoped[flagged] : undefined;
  return hit ? { field: hit.field, source: 'moderation' } : null;
}
