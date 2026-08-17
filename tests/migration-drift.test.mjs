import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/check-migration-drift.mjs', import.meta.url);

function run(table, ...args) {
  const dir = mkdtempSync(join(tmpdir(), 'migration-drift-'));
  const input = join(dir, 'migration-list.txt');
  writeFileSync(input, table);
  return spawnSync(process.execPath, [script.pathname, input, ...args], { encoding: 'utf8' });
}

const header = `\n Local            | Remote           | Time (UTC)\n------------------|------------------|-----------------------\n`;

test('passes when repository and production histories match exactly', () => {
  const result = run(`${header} 20260813120000 | 20260813120000 | 2026-08-13 12:00:00\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exactly aligned/);
});

test('fails closed when production contains a migration missing from the repository', () => {
  const result = run(`${header}                  | 20260814021000 | 2026-08-14 02:10:00\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production has applied migrations missing/);
  assert.match(result.stderr, /20260814021000/);
});

test('allows pending repository migrations only in pre-deploy mode', () => {
  const table = `${header} 20260817090000 |                  | 2026-08-17 09:00:00\n`;
  const strict = run(table);
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /not applied in production/);

  const preDeploy = run(table, '--allow-pending-local');
  assert.equal(preDeploy.status, 0, preDeploy.stderr);
  assert.match(preDeploy.stdout, /Pending repository migrations/);
});

test('parses Supabase JSON output as well as the human-readable table', () => {
  const result = run('Initialising login role...\n{"migrations":[{"local":"20260813120000","remote":"20260813120000","time":"2026-08-13 12:00:00"}],"message":"Migrations listed"}\n');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exactly aligned/);
});

test('fails closed when CLI output cannot be parsed', () => {
  const result = run('authentication failed\n');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Failing closed/);
});

test('trusted PR workflow overlays candidate migration filenames without executing PR code', () => {
  const workflow = readFileSync(new URL('../.github/workflows/migration-drift.yml', import.meta.url), 'utf8');
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /gh api --paginate --slurp/);
  assert.match(workflow, /pulls\/\$PR_NUMBER\/files/);
  assert.match(workflow, /previous_filename/);
  assert.match(workflow, /--allow-pending-local/);
  assert.doesNotMatch(workflow, /pull_request\.head\.sha/);
});
