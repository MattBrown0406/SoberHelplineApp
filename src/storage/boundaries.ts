import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BoundaryWall } from '../api/types';

const KEY = '@sh:walls';

export async function getWalls(): Promise<BoundaryWall[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BoundaryWall[]) : [];
  } catch {
    return [];
  }
}

export async function saveWall(wall: BoundaryWall): Promise<void> {
  const current = await getWalls();
  await AsyncStorage.setItem(KEY, JSON.stringify([...current, wall]));
}

export async function deleteWall(id: string): Promise<void> {
  const current = await getWalls();
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify(current.filter((w) => w.id !== id)),
  );
}
