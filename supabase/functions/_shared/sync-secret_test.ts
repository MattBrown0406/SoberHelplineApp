import { requireSyncSecret } from './sync-secret.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, received ${String(actual)}`);
}

const post = (secret?: string) => new Request('https://example.test', {
  method: 'POST',
  headers: secret === undefined ? {} : { 'x-membership-sync-secret': secret },
});

Deno.test('the website secret gate only accepts POST', () => {
  const response = requireSyncSecret(new Request('https://example.test', {
    method: 'GET',
    headers: { 'x-membership-sync-secret': 'shared-secret' },
  }), 'shared-secret');
  assertEquals(response?.status, 405);
});

Deno.test('the website secret gate rejects a missing or wrong secret', () => {
  assertEquals(requireSyncSecret(post(), 'shared-secret')?.status, 401);
  assertEquals(requireSyncSecret(post('shared-secreT'), 'shared-secret')?.status, 401);
  assertEquals(requireSyncSecret(post('shared-secret-and-more'), 'shared-secret')?.status, 401);
  assertEquals(requireSyncSecret(post(''), 'shared-secret')?.status, 401);
});

Deno.test('an unconfigured secret fails closed', () => {
  assertEquals(requireSyncSecret(post('anything'), '')?.status, 401);
  assertEquals(requireSyncSecret(post(''), '')?.status, 401);
});

Deno.test('the exact shared secret passes', () => {
  assertEquals(requireSyncSecret(post('shared-secret'), 'shared-secret'), null);
});
