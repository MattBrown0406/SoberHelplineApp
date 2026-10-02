import { secretMatches, webSsoTier } from './web-sso.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test('the website secret must match exactly', () => {
  assertEquals(secretMatches('abc123', 'abc123'), true);
  assertEquals(secretMatches('abc124', 'abc123'), false);
  assertEquals(secretMatches('abc12', 'abc123'), false);
  assertEquals(secretMatches('', 'abc123'), false);
  assertEquals(secretMatches(null, 'abc123'), false);
  assertEquals(secretMatches('abc123', undefined), false);
  assertEquals(secretMatches('abc123', ''), false);
});

Deno.test('premier outranks essential; everyone else is a free non-member', () => {
  assertEquals(webSsoTier(true, true), { tier: 'premier', member: true });
  assertEquals(webSsoTier(false, true), { tier: 'essential', member: true });
  assertEquals(webSsoTier(false, false), { tier: 'free', member: false });
});
