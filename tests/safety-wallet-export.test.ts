import test from 'node:test';
import assert from 'node:assert/strict';
import { walletExportItems, selectedWalletText, walletPrintHtml } from '../src/lib/safetyWalletExport';
import { DEFAULT_SAFETY_PLAN } from '../src/lib/safetyWallet';
const plan = { ...DEFAULT_SAFETY_PLAN, emergencyContacts: 'Alex <script>alert(1)</script>', insurance: 'PRIVATE' };
const items = walletExportItems(plan, [], (key) => key);
test('nothing selected exports nothing; contacts do not disclose private fields', () => {
  assert.equal(selectedWalletText(items, [], 'Wallet', 'Not monitored'), '');
  const text = selectedWalletText(items, ['plan:emergencyContacts'], 'Wallet', 'Not monitored');
  assert.match(text, /Alex/);
  assert.doesNotMatch(text, /PRIVATE|insurance/);
  assert.equal(selectedWalletText(items, ['unknown'], 'Wallet', 'Not monitored'), '');
});
test('print uses exactly preview text, escaped as inert HTML', () => {
  const preview = selectedWalletText(items, ['plan:emergencyContacts'], 'Wallet', 'Not monitored');
  const html = walletPrintHtml(preview);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('PRIVATE'));
  assert.match(html, /Not monitored/);
});
test('incidents require individual selection and export only the displayed summary', () => {
  const all = walletExportItems(plan, [{ id: 'one', createdAt: '2026-01-01', summary: 'Chosen summary', threats: 'Hidden detail', substances: '', childrenPresent: false, policeOrEms: false, boundaryCrossed: false }], (key) => key);
  const text = selectedWalletText(all, ['incident:one'], 'Wallet', 'Note');
  assert.match(text, /Chosen summary/);
  assert.doesNotMatch(text, /Hidden detail|Alex|PRIVATE/);
});
