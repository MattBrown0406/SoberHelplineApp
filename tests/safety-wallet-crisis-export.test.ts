import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('crisis summary and command cannot bypass the selective exporter', () => {
  const source = readFileSync('app/crisis-mode.tsx', 'utf8');
  assert.doesNotMatch(source, /Share\.share|shareSummary/);
  assert.match(source, /SafetyWalletExport[^>]+items=\{summaryExportItems\}/);
  assert.match(source, /SafetyWalletExport[^>]+items=\{commandExportItems\}/);
  assert.match(source, /situation && canShareWallet && hydrated/);
  assert.match(source, /useFeatureAccess\('safetyWalletShare'\)/);
  assert.doesNotMatch(source, /summaryExportItems: WalletExportItem\[\] = situation && hasEssential/);
  // The offline command plan card (saved plan, offline fallback) shares too.
  assert.match(source, /commandPlanVisible = \(hasPremier \|\| \(isOfflineAccountFallback && savedCommandPlan\)\) && hydrated/);
  assert.match(source, /commandExportItems: WalletExportItem\[\] = commandPlanVisible \?/);
  assert.match(source, /\{commandPlanVisible \? \(/);
  assert.match(source, /scope=\{user\?\.id/);
});
