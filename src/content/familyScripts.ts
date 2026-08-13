import type { Script } from '../api/types';
import { getScripts } from './scripts';

export type FamilyScriptKind = 'money' | 'housing' | 'crisis' | 'custom';

const KIND_TO_SCRIPT: Record<Exclude<FamilyScriptKind, 'custom'>, string> = {
  money: 'script-money',
  housing: 'script-housing',
  crisis: 'script-crisis',
};

/**
 * Pick one shared family script so everyone rehearses the same words.
 * Mixed messages are how the addicted person splits the family.
 */
export function matchFamilyScriptKind(wallText: string): FamilyScriptKind {
  const t = wallText.toLowerCase();
  if (
    /\b(money|cash|bill|debt|loan|venmo|zelle|dollar|pay(ing)?)\b/.test(t) ||
    /\b(dinero|efectivo|deuda|cuenta)\b/.test(t)
  ) {
    return 'money';
  }
  if (
    /\b(hous(e|ing)|home|stay here|live here|evict|apartment|lease)\b/.test(t) ||
    /\b(casa|vivienda|hogar)\b/.test(t)
  ) {
    return 'housing';
  }
  if (
    /\b(2\s*a\.?m\.?|2am|midnight|late[- ]?night|phone call|crisis)\b/.test(t) ||
    /\b(llamada|madrugada|crisis)\b/.test(t)
  ) {
    return 'crisis';
  }
  return 'custom';
}

function customFamilyScript(wallText: string, language?: string): Script {
  const es = language?.startsWith('es');
  const trimmed = wallText.trim();
  return {
    id: 'script-family-shared',
    tag: 'FAMILY',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    title: es ? 'Lo que diremos — juntos' : 'What we will say — together',
    trySaying: es
      ? `Hablamos en familia. ${trimmed} Eso es lo que vamos a decir todos.`
      : `We've talked as a family. ${trimmed} That's what all of us will say.`,
    avoid: es
      ? 'Un familiar ablanda el límite mientras otro lo sostiene. Una sola voz, o la adicción divide la casa.'
      : 'One relative softening the limit while another holds it. One voice, or the addiction splits the house.',
    why: es
      ? 'Los mensajes mezclados enseñan a buscar el eslabón más débil. Ensayad las mismas palabras.'
      : 'Mixed messages teach them to shop for the weakest link. Rehearse the same words.',
    comeback: {
      theySay: es ? 'Mamá / papá me diría que sí.' : 'Mom / Dad would say yes.',
      youSay: es
        ? 'Hablamos. Esta es la respuesta de la familia. No va a cambiar según a quién llames.'
        : "We talked. This is the family's answer. It doesn't change depending on who you call.",
    },
    suggestedTemperament: 'defensive',
    isCustom: false,
    requestedFromCoachId: null,
  };
}

export function sharedFamilyScript(wallText: string, language?: string): Script {
  const kind = matchFamilyScriptKind(wallText);
  if (kind === 'custom') return customFamilyScript(wallText, language);
  const library = getScripts(language);
  const match = library.find((script) => script.id === KIND_TO_SCRIPT[kind]);
  if (!match) return customFamilyScript(wallText, language);
  return {
    ...match,
    tag: 'FAMILY',
    title: language?.startsWith('es')
      ? `Lo que diremos: ${match.title}`
      : `What we will say: ${match.title}`,
  };
}

export function isWallAligned(
  committedCount: number,
  memberCount: number,
  hasWavering: boolean,
): boolean {
  return memberCount > 0 && committedCount >= memberCount && !hasWavering;
}
