import type { PracticeSource } from './practiceScenarios';

/**
 * In-memory handoff for long practice text (the intervention letter). A URL
 * param would put the member's private letter in browser history on web and
 * silently cut it; instead the text stays in this module and only a short,
 * random token travels in the route. Each entry belongs to the account that
 * stashed it and is only ever handed back to that account; signing out clears
 * the whole store (practiceHandoffAuth.ts). A reload simply means "no text".
 */
export type PracticeHandoff = { text: string; source: PracticeSource };
type Entry = PracticeHandoff & { accountId: string };

const MAX_ENTRIES = 3;
const store = new Map<string, Entry>();
let counter = 0;

function tokenOf(token: unknown): string | null {
  const value = Array.isArray(token) ? token[0] : token;
  return typeof value === 'string' && value ? value : null;
}

export function stashPracticeText(text: string, source: PracticeSource, accountId: string): string {
  counter += 1;
  const token = `p${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  store.set(token, { text, source, accountId });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  return token;
}

/** Read without consuming (safe from a render) — only for the account that stashed it. */
export function peekPracticeText(token: unknown, accountId: string | null | undefined): PracticeHandoff | null {
  const key = tokenOf(token);
  const entry = key ? store.get(key) : undefined;
  if (!entry || !accountId || entry.accountId !== accountId) return null;
  return { text: entry.text, source: entry.source };
}

/** Consume: once the practice screen has the text — or the paywall turned the member away. */
export function releasePracticeText(token: unknown): void {
  const key = tokenOf(token);
  if (key) store.delete(key);
}

/** Sign-out: nothing one member stashed may survive into another member's session. */
export function clearPracticeHandoffs(): void {
  store.clear();
}

export function practiceHandoffCount(): number {
  return store.size;
}
