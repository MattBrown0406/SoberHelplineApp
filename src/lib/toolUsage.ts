import { logFunnelEvent } from './funnel';
import { toolUsageKey, type UsageTool } from './toolUsageNames';

export type { UsageTool } from './toolUsageNames';

/**
 * Which tools families use (funnel stages tool_opened / tool_finished).
 * Only the tool's name is sent — never what she wrote, chose or saw — and the
 * server keeps at most one of each per member, tool and day; this module also
 * skips repeats within a day so a tab switch is not a network call.
 */
const logged = new Set<string>();

/** True when the event was handed to the server (first time today). */
export function logToolUsage(tool: UsageTool, stage: 'opened' | 'finished', nowMs = Date.now()): boolean {
  const key = toolUsageKey(tool, stage, nowMs);
  if (logged.has(key)) return false;
  logged.add(key);
  logFunnelEvent(stage === 'opened' ? 'tool_opened' : 'tool_finished', { tool });
  return true;
}
