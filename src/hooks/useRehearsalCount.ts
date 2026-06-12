import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@sh:rehearsal_counts';

async function loadCounts(): Promise<Record<string, number>> {
  try {
    const val = await AsyncStorage.getItem(KEY);
    return val ? JSON.parse(val) : {};
  } catch {
    return {};
  }
}

async function saveCounts(counts: Record<string, number>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(counts));
  } catch {}
}

export function useRehearsalCount(sourceId: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    loadCounts().then((c) => setCount(c[sourceId] ?? 0));
  }, [sourceId]);

  const increment = useCallback(async () => {
    const counts = await loadCounts();
    const next = (counts[sourceId] ?? 0) + 1;
    counts[sourceId] = next;
    await saveCounts(counts);
    setCount(next);
  }, [sourceId]);

  return { count, increment };
}
