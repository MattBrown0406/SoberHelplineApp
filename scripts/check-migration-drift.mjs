#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const allowPendingLocal = args.includes('--allow-pending-local');
const inputPath = args.find((arg) => !arg.startsWith('--'));

if (!inputPath) {
  console.error('Usage: node scripts/check-migration-drift.mjs <migration-list.txt> [--allow-pending-local]');
  process.exit(2);
}

const input = readFileSync(inputPath, 'utf8').replaceAll('`', '');
const local = new Set();
const remote = new Set();

for (const line of input.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (trimmed.startsWith('{"migrations"')) {
    try {
      const payload = JSON.parse(trimmed);
      for (const migration of payload.migrations ?? []) {
        if (migration.local) local.add(String(migration.local));
        if (migration.remote) remote.add(String(migration.remote));
      }
      continue;
    } catch {
      // Fall through to the table parser, then fail closed if nothing is valid.
    }
  }

  const match = line.match(/^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|/);
  if (!match) continue;
  if (match[1]) local.add(match[1]);
  if (match[2]) remote.add(match[2]);
}

if (local.size === 0 && remote.size === 0) {
  console.error('Could not parse any migration versions from Supabase CLI output. Failing closed.');
  process.exit(2);
}

const remoteOnly = [...remote].filter((version) => !local.has(version)).sort();
const localOnly = [...local].filter((version) => !remote.has(version)).sort();

if (remoteOnly.length > 0) {
  console.error('Migration drift detected: production has applied migrations missing from this repository:');
  for (const version of remoteOnly) console.error(`  - ${version}`);
}

if (localOnly.length > 0) {
  const label = allowPendingLocal
    ? 'Pending repository migrations (allowed before deployment):'
    : 'Migration drift detected: repository migrations are not applied in production:';
  console[allowPendingLocal ? 'log' : 'error'](label);
  for (const version of localOnly) console[allowPendingLocal ? 'log' : 'error'](`  - ${version}`);
}

if (remoteOnly.length > 0 || (!allowPendingLocal && localOnly.length > 0)) {
  process.exit(1);
}

console.log(`Migration history is ${allowPendingLocal ? 'safe (no production-only versions)' : 'exactly aligned'}: ${local.size} local / ${remote.size} production.`);
