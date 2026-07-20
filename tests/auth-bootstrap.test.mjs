import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/authBootstrap.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const testDirectory = await mkdtemp(join(tmpdir(), 'shl-auth-bootstrap-'));
const modulePath = join(testDirectory, 'authBootstrap.mjs');
await writeFile(modulePath, output);
const {
  AccountRequestGate,
  getInitialLayoutState,
  resolveDirectAccountState,
  resolveRefreshedDirectAccountState,
  withTimeoutFallback,
} = await import(pathToFileURL(modulePath).href);

test('authenticated account loading never renders the idle auth stack', () => {
  assert.equal(
    getInitialLayoutState({
      isAuthenticated: true,
      isLoading: true,
      hasUser: false,
      onboardingReady: false,
      hasAccountError: false,
    }),
    'bootstrap',
  );
});

test('authenticated onboarding lookup keeps the bootstrap screen visible', () => {
  assert.equal(
    getInitialLayoutState({
      isAuthenticated: true,
      isLoading: false,
      hasUser: true,
      onboardingReady: false,
      hasAccountError: false,
    }),
    'bootstrap',
  );
});

test('account bootstrap failures replace the auth screen with a retry state', () => {
  assert.equal(
    getInitialLayoutState({
      isAuthenticated: true,
      isLoading: false,
      hasUser: false,
      onboardingReady: false,
      hasAccountError: true,
    }),
    'account-error',
  );
});

test('signed-out and fully hydrated states render the router stack', () => {
  assert.equal(
    getInitialLayoutState({
      isAuthenticated: false,
      isLoading: false,
      hasUser: false,
      onboardingReady: false,
      hasAccountError: false,
    }),
    'stack',
  );
  assert.equal(
    getInitialLayoutState({
      isAuthenticated: true,
      isLoading: false,
      hasUser: true,
      onboardingReady: true,
      hasAccountError: false,
    }),
    'stack',
  );
});

test('optional provider enrichment has a bounded fallback', async () => {
  const started = Date.now();
  const result = await withTimeoutFallback(new Promise(() => {}), 25, 'fallback');
  assert.equal(result, 'fallback');
  assert.ok(Date.now() - started < 500, 'timeout fallback should resolve promptly');
});

test('optional provider success and failure resolve predictably', async () => {
  assert.equal(await withTimeoutFallback(Promise.resolve('premium'), 100, 'free'), 'premium');
  assert.equal(
    await withTimeoutFallback(Promise.reject(new Error('provider down')), 100, 'free'),
    'free',
  );
});

test('new account requests fence stale bootstrap, enrichment, refresh, and logout work', () => {
  const gate = new AccountRequestGate();
  const originalDirectBootstrap = gate.begin();
  assert.equal(gate.isCurrent(originalDirectBootstrap), true);

  const attachedProviderRefresh = gate.begin();
  assert.equal(gate.isCurrent(originalDirectBootstrap), false);
  assert.equal(gate.isCurrent(attachedProviderRefresh), true);

  gate.invalidate();
  assert.equal(gate.isCurrent(attachedProviderRefresh), false);
});

test('successful entitlement refresh supports revocation and deterministic tier precedence', () => {
  const now = new Date('2026-07-20T12:00:00.000Z');
  assert.equal(resolveDirectAccountState([], now), 'direct-free');
  assert.equal(
    resolveDirectAccountState([{ tier: 'premium', expires_at: '2026-07-19T12:00:00.000Z' }], now),
    'direct-free',
  );
  assert.equal(
    resolveDirectAccountState([
      { tier: 'essential', expires_at: null },
      { tier: 'premium', expires_at: null },
    ], now),
    'direct-premium',
  );
});

test('authoritative database revocation cannot be overridden by stale RevenueCat state', () => {
  assert.equal(
    resolveRefreshedDirectAccountState({
      databaseRows: [],
      previousState: 'direct-premium',
      revenueCatTier: 'premium',
    }),
    'direct-free',
  );
  assert.equal(
    resolveRefreshedDirectAccountState({
      databaseRows: null,
      previousState: 'direct-free',
      revenueCatTier: 'essential',
    }),
    'direct-essential',
  );
});
