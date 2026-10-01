import { buildResetEmail, normalizeResetEmail, sha256Hex } from './password-reset.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('reset emails are normalized and validated', () => {
  assert(normalizeResetEmail('  Mom@Example.COM ') === 'mom@example.com', 'trims and lowercases');
  assert(normalizeResetEmail('not-an-email') === null, 'rejects malformed');
  assert(normalizeResetEmail(42) === null, 'rejects non-strings');
});

Deno.test('the email carries the code in both languages and never raw HTML', () => {
  const en = buildResetEmail('en', '123456');
  const es = buildResetEmail('es', '123456');
  assert(en.html.includes('123456') && en.text.includes('123456'), 'code in EN email');
  assert(es.subject.includes('contraseña') && es.html.includes('123456'), 'Spanish email');
  assert(!buildResetEmail('en', '<b>1</b>').html.includes('<b>1</b>'), 'code is escaped');
});

Deno.test('hashes are stable 64-character hex', async () => {
  const a = await sha256Hex('mom@example.com');
  assert(a.length === 64 && a === await sha256Hex('mom@example.com'), 'stable sha256');
});
