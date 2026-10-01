/**
 * Invitation kit — deterministic, editable template lines used whenever the AI
 * draft is unavailable (offline, no key, daily cap) or missing a style. Each
 * line is CRAFT-shaped: love + a specific observation + an invitation to one
 * next step + an offer of help. Copy lives in invitation.json under lines.*;
 * this module only chooses fragments and parameters.
 */

export const LINE_STYLES = ['warm', 'observation', 'help'] as const;
export type LineStyle = typeof LINE_STYLES[number];

export type LineFragment = { key: string; params?: Record<string, string> };
export type TemplateLine = { style: LineStyle; fragments: LineFragment[] };

export type LineContext = {
  /** Loved one's first name or nickname, or empty. */
  name: string;
  /** Something specific the family noticed, said to them ("you've seemed so tired"). */
  observation: string;
  /** Program name from the Treatment Action Plan, or empty. */
  program: string;
};

export const OBSERVATION_MAX = 200;

/**
 * Fit the family's observation into "I noticed …": one line, no trailing
 * punctuation, and a lower-case start unless it begins with "I".
 */
export function normalizeObservation(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/u, '').slice(0, OBSERVATION_MAX).trim();
  if (!text) return '';
  if (/^(I|I'|I’)\b/.test(text)) return text;
  return text.charAt(0).toLocaleLowerCase() + text.slice(1);
}

function love(ctx: LineContext, variant: 'open' | 'close'): LineFragment {
  return ctx.name
    ? { key: `lines.love.${variant}Named`, params: { name: ctx.name } }
    : { key: `lines.love.${variant}` };
}

function observe(ctx: LineContext): LineFragment {
  const observation = normalizeObservation(ctx.observation);
  return observation
    ? { key: 'lines.observe.own', params: { observation } }
    : { key: 'lines.observe.generic' };
}

function invite(ctx: LineContext): LineFragment {
  const program = ctx.program.trim();
  return program
    ? { key: 'lines.invite.program', params: { program } }
    : { key: 'lines.invite.generic' };
}

export function templateLines(ctx: LineContext): TemplateLine[] {
  return [
    { style: 'warm', fragments: [love(ctx, 'open'), observe(ctx), invite(ctx), { key: 'lines.help.drive' }] },
    { style: 'observation', fragments: [observe(ctx), { key: 'lines.observe.impact' }, invite(ctx), { key: 'lines.help.call' }] },
    { style: 'help', fragments: [{ key: 'lines.help.lead' }, invite(ctx), { key: 'lines.help.sit' }, love(ctx, 'close')] },
  ];
}

/** Render a template with a translate function (keeps this module i18n-free). */
export function renderTemplateLine(
  line: TemplateLine,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  return line.fragments.map((fragment) => t(fragment.key, fragment.params)).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Conversation practice caps text that travels in a URL param at this length
 * (MAX_URL_TEXT_CHARS in src/lib/practiceScenarios.ts; a test keeps them equal).
 */
export const PRACTICE_URL_TEXT_MAX = 600;

/**
 * Anything longer than one short line (the whole kit) goes through the
 * in-memory practice handoff instead of the URL, so it is neither cut nor left
 * in browser history.
 */
export function practiceNeedsHandoff(text: string): boolean {
  return /[\r\n]/.test(text) || text.length > PRACTICE_URL_TEXT_MAX;
}

/** The whole kit as one practice script for conversation practice. */
export function kitPracticeText(lines: readonly string[], nextStep: string): string {
  const body = lines.map((line) => line.trim()).filter(Boolean).join('\n\n');
  return [body, nextStep.trim()].filter(Boolean).join('\n\n').slice(0, 1200);
}

// Gentle guard for lines the family edits themselves (mirrors the server's
// stricter check in supabase/functions/_shared/invitation-coach.ts).
const CONCERN_PATTERNS: RegExp[] = [
  /\b(addict|addicts|alcoholic|alcoholics|junkie|druggie|crackhead|drunkard|loser)\b/i,
  /\bor else\b|\blast chance\b|\bultimatum\b/i,
  /\bif you don'?t (go|get help|stop|quit|agree|accept)\b/i,
  /\byou (always|never)\b/i,
  /(?:^|[^\p{L}])(adict[oa]s?|alcoh[óo]lic[oa]s?|drogadict[oa]s?|yonqui|drogata)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(o si no|[úu]ltima oportunidad|ultim[áa]tum)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(siempre|nunca) (haces|dices|est[áa]s)(?![\p{L}])/iu,
];

/** True when an edited line carries a label, ultimatum or "you always/never". */
export function lineNeedsSoftening(text: string): boolean {
  return CONCERN_PATTERNS.some((pattern) => pattern.test(text));
}
