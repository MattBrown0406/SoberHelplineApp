import { requireServiceRole } from './service-auth.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, received ${String(actual)}`);
}

Deno.test('service auth rejects non-POST methods', () => {
  const response = requireServiceRole(new Request('https://example.test', { method: 'GET' }), 'service-secret');
  assertEquals(response?.status, 405);
});

Deno.test('service auth rejects missing or incorrect bearer tokens', () => {
  assertEquals(requireServiceRole(new Request('https://example.test', { method: 'POST' }), 'service-secret')?.status, 401);
  assertEquals(requireServiceRole(new Request('https://example.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong-secret' },
  }), 'service-secret')?.status, 401);
});

Deno.test('service auth accepts the exact service-role bearer token', () => {
  assertEquals(requireServiceRole(new Request('https://example.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer service-secret' },
  }), 'service-secret'), null);
});
