import {
  AsyncWriteBarrier,
  finalizeRecording,
  requireSavedData,
  togglePickerMode,
} from '../../../src/lib/appFlowGuards.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function assertRejects(run: () => Promise<unknown>, message: string) {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error(message);
}

Deno.test('save guard rejects Supabase errors and empty responses', () => {
  const databaseError = new Error('write failed');
  try {
    requireSavedData({ id: 'ignored' }, databaseError, 'empty');
    throw new Error('expected database error');
  } catch (error) {
    assert(error === databaseError, 'must preserve the original database error');
  }

  try {
    requireSavedData(null, null, 'empty response');
    throw new Error('expected empty-response error');
  } catch (error) {
    assert(error instanceof Error && error.message === 'empty response', 'must reject empty saves');
  }

  const saved = { id: 'saved' };
  assert(requireSavedData(saved, null, 'empty') === saved, 'must return successful data');
});

Deno.test('picker state is mutually exclusive and toggleable', () => {
  assert(togglePickerMode(null, 'date') === 'date', 'date picker should open');
  assert(togglePickerMode('date', 'time') === 'time', 'time picker must replace date picker');
  assert(togglePickerMode('time', 'time') === null, 'active picker should close when toggled');
});

Deno.test('recording finalization remains successful when audio-mode restoration fails', async () => {
  let stopped = false;
  const restoreFailure = new Error('audio mode');
  const result = await finalizeRecording(
    async () => { stopped = true; },
    () => 'file:///recording.m4a',
    async () => { throw restoreFailure; },
  );
  assert(stopped, 'recording must be unloaded');
  assert(result.uri === 'file:///recording.m4a', 'recording URI must be retained');
  assert(result.restoreError === restoreFailure, 'restore failure must remain observable');
});

Deno.test('recording finalization does not restore audio mode when unloading fails', async () => {
  let restored = false;
  await assertRejects(
    () => finalizeRecording(
      async () => { throw new Error('stop failed'); },
      () => null,
      async () => { restored = true; },
    ),
    'stop failure must reject',
  );
  assert(!restored, 'audio restoration must not mask a failed unload');
});

Deno.test('write barrier invalidates acquisition and waits for every in-flight write', async () => {
  const barrier = new AsyncWriteBarrier();
  const generation = barrier.begin('account');
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  void barrier.track('account', first);
  void barrier.track('account', second);

  let cancelled = false;
  const cancellation = barrier.cancelAndWait('account').then(() => { cancelled = true; });
  await Promise.resolve();
  assert(!barrier.isCurrent('account', generation), 'cancel must invalidate token acquisition');
  assert(!cancelled, 'cancel must wait while writes are pending');

  releaseFirst();
  await Promise.resolve();
  assert(!cancelled, 'cancel must wait for all concurrent writes');
  releaseSecond();
  await cancellation;
  assert(cancelled, 'cancel should resolve after every write settles');
});
