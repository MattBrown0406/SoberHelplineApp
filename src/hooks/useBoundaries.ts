import { useState, useEffect, useCallback } from 'react';
import type { BoundaryWall } from '../api/types';
import {
  getWalls,
  saveWall,
  deleteWall as deleteWallFromStorage,
} from '../storage/boundaries';

export function useBoundaries() {
  const [walls, setWalls] = useState<BoundaryWall[]>([]);

  useEffect(() => {
    getWalls().then(setWalls);
  }, []);

  const addWall = useCallback(async (text: string, anchorTag: string | null) => {
    const wall: BoundaryWall = {
      id: `wall-${Date.now()}`,
      userId: 'local',
      text: text.trim(),
      anchorType: null,
      anchorTag,
      createdAt: new Date().toISOString(),
      sharedWithCoachAt: null,
    };
    await saveWall(wall);
    setWalls((prev) => [...prev, wall]);
  }, []);

  const removeWall = useCallback(async (id: string) => {
    await deleteWallFromStorage(id);
    setWalls((prev) => prev.filter((w) => w.id !== id));
  }, []);

  return { walls, addWall, removeWall };
}
