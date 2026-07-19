export class AsyncWriteBarrier {
  private generations = new Map<string, number>();
  private pending = new Map<string, Set<Promise<unknown>>>();

  begin(key: string): number {
    return this.generations.get(key) ?? 0;
  }

  isCurrent(key: string, generation: number): boolean {
    return (this.generations.get(key) ?? 0) === generation;
  }

  track<T>(key: string, write: Promise<T>): Promise<T> {
    const writes = this.pending.get(key) ?? new Set<Promise<unknown>>();
    writes.add(write);
    this.pending.set(key, writes);
    return write.finally(() => {
      writes.delete(write);
      if (!writes.size) this.pending.delete(key);
    });
  }

  async cancelAndWait(key: string): Promise<void> {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    const writes = Array.from(this.pending.get(key) ?? []);
    await Promise.all(writes.map((write) => write.catch(() => undefined)));
  }
}

export function requireSavedData<T>(data: T | null, error: unknown, emptyMessage: string): T {
  if (error) throw error;
  if (data === null) throw new Error(emptyMessage);
  return data;
}

export type PickerMode = 'date' | 'time' | null;

export function togglePickerMode(current: PickerMode, requested: Exclude<PickerMode, null>): PickerMode {
  return current === requested ? null : requested;
}

export interface RecordingFinalization {
  uri: string | null;
  restoreError: unknown | null;
}

export async function finalizeRecording(
  stopAndUnload: () => Promise<unknown>,
  getUri: () => string | null,
  restoreAudioMode: () => Promise<unknown>,
): Promise<RecordingFinalization> {
  await stopAndUnload();
  const uri = getUri();
  try {
    await restoreAudioMode();
    return { uri, restoreError: null };
  } catch (restoreError) {
    return { uri, restoreError };
  }
}
