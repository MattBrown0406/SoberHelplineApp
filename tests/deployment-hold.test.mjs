import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('code-only main commits hold deployments without disabling quality', () => {
  const predicate = "if: github.event_name != 'push' || !contains(github.event.head_commit.message, '[hold deployment]')";
  const web = read('.github/workflows/deploy-web.yml');
  const backend = read('.github/workflows/supabase-functions.yml');
  assert.ok(web.includes('  build-and-deploy:\n    # A code-only handoff may explicitly hold production-facing deployment.\n    ' + predicate));
  assert.ok(backend.includes('  migrate:\n    # Manual dispatch remains available after deployment approval.\n    ' + predicate));
  assert.match(backend, /deploy-functions:\s+needs: migrate/);
  assert.match(backend, /quality:\s+uses: \.\/\.github\/workflows\/quality.yml/);
  const quality = read('.github/workflows/quality.yml');
  assert.ok(quality.includes('group: quality-${{ github.workflow }}-${{ github.ref }}'));
  assert.match(quality, /run: npm test/);
  assert.ok(!quality.includes('[hold deployment]'));
});
