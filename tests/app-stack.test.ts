import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseAppStack } from '../src/lib/appStack';

// expo-router's container state: an internal `__root` route holding app/_layout's Stack.
function ref(appRoutes: number, ready = true) {
  const actions: unknown[] = [];
  const app = { key: 'stack-app', type: 'stack', index: appRoutes - 1, routes: Array.from({ length: appRoutes }, () => ({})) };
  return {
    actions,
    isReady: () => ready,
    getRootState: () => ({ key: 'stack-root', type: 'stack', index: 0, routes: [{ state: app }] }),
    dispatch: (action: unknown) => { actions.push(action); },
  };
}

test('signing out from Settings pops the app stack, not the internal root', () => {
  const r = ref(2);
  collapseAppStack(r);
  assert.deepEqual(r.actions, [{ type: 'POP_TO_TOP', target: 'stack-app' }]);
});

test('a single-screen app stack or an unready container is left alone', () => {
  for (const r of [ref(1), ref(3, false)]) {
    collapseAppStack(r);
    assert.deepEqual(r.actions, []);
  }
});
