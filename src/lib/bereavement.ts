/**
 * When her loved one has died. loved_ones.died_at is set for her own account
 * through mark_loved_one_died(); from then on the app stops asking about them
 * and Today shows the grief card instead. Pure, so tests can import it.
 */
export function isBereaved(lovedOne: { died_at?: string | null } | null | undefined): boolean {
  return typeof lovedOne?.died_at === 'string' && lovedOne.died_at.length > 0;
}

/** Peer support for families after a death from addiction (opened in the browser). */
export const GRIEF_RESOURCES = [
  { key: 'grasp', url: 'https://grasphelp.org', site: 'grasphelp.org' },
  { key: 'compassionateFriends', url: 'https://www.compassionatefriends.org', site: 'compassionatefriends.org' },
] as const;
