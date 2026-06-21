import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface WeekPoint {
  week: string; // YYYY-MM-DD (Monday)
  warnings: number;
  recoveries: number;
  net: number; // warnings − recoveries
}

export type TrajectoryTrend = 'improving' | 'worsening' | 'steady' | 'none';

function mondayOf(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

/**
 * Weekly warning/recovery aggregates from tracker_logs over the last `weeks`
 * weeks (continuous, zero-filled), plus a coarse trend read for the funnel.
 */
export function useTrajectory(accountId: string | null, weeks = 6) {
  const [points, setPoints] = useState<WeekPoint[]>([]);
  const [trend, setTrend] = useState<TrajectoryTrend>('none');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) {
      setPoints([]);
      setTrend('none');
      setLoading(false);
      return;
    }
    setLoading(true);

    const start = mondayOf(new Date());
    start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7);
    const startStr = start.toISOString().slice(0, 10);

    const { data } = await supabase
      .from('tracker_logs')
      .select('week, kind')
      .eq('account_id', accountId)
      .gte('week', startStr);

    const buckets = new Map<string, { warnings: number; recoveries: number }>();
    for (let i = 0; i < weeks; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i * 7);
      buckets.set(d.toISOString().slice(0, 10), { warnings: 0, recoveries: 0 });
    }
    (data ?? []).forEach((r) => {
      const wk = String(r.week).slice(0, 10);
      const b = buckets.get(wk);
      if (!b) return;
      if (r.kind === 'warning') b.warnings++;
      else if (r.kind === 'recovery') b.recoveries++;
    });

    const pts: WeekPoint[] = Array.from(buckets.entries()).map(([week, b]) => ({
      week,
      warnings: b.warnings,
      recoveries: b.recoveries,
      net: b.warnings - b.recoveries,
    }));

    setPoints(pts);
    setTrend(computeTrend(pts));
    setLoading(false);
  }, [accountId, weeks]);

  useEffect(() => {
    void load();
  }, [load]);

  return { points, trend, loading, refresh: load };
}

function computeTrend(pts: WeekPoint[]): TrajectoryTrend {
  const active = pts.filter((p) => p.warnings + p.recoveries > 0);
  if (active.length < 2) return 'none';
  const half = Math.max(1, Math.floor(pts.length / 2));
  const older = pts.slice(0, half);
  const recent = pts.slice(pts.length - half);
  const avg = (arr: WeekPoint[]) => arr.reduce((s, p) => s + p.net, 0) / arr.length;
  const diff = avg(recent) - avg(older);
  if (diff >= 1) return 'worsening';
  if (diff <= -1) return 'improving';
  return 'steady';
}
