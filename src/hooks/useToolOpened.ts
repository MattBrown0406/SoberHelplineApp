import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { logToolUsage } from '../lib/toolUsage';
import type { UsageTool } from '../lib/toolUsageNames';

/** Records that this tool's screen was opened (once per tool per day). */
export function useToolOpened(tool: UsageTool): void {
  useFocusEffect(useCallback(() => { logToolUsage(tool, 'opened'); }, [tool]));
}
