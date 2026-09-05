import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('crisis summary and command cannot bypass the selective exporter', () => {
  const source = readFileSync('app/crisis-mode.tsx', 'utf8');
  assert.doesNotMatch(source, /Share\.share|shareSummary/);
  assert.match(source, /SafetyWalletExport[^>]+items=\{summaryExportItems\}/);
  assert.match(source, /SafetyWalletExport[^>]+items=\{commandExportItems\}/);
  assert.match(source, /situation && hasEssential && hydrated/);
  assert.match(source, /commandExportItems: WalletExportItem\[\] = hasPremier && hydrated/);
  assert.match(source, /scope=\{user\?\.id/);
});
