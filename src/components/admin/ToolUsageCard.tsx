import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';

type ToolRow = { tool: string; members_opened: number; members_finished: number; days_opened: number };

export function parseToolUsage(value: unknown): { days: number; tools: ToolRow[] } | null {
  const row = value as { days?: unknown; tools?: unknown } | null;
  if (!row || typeof row.days !== 'number' || !Array.isArray(row.tools)) return null;
  const tools = row.tools.filter((t): t is ToolRow => !!t && typeof t === 'object'
    && typeof (t as ToolRow).tool === 'string'
    && typeof (t as ToolRow).members_opened === 'number'
    && typeof (t as ToolRow).members_finished === 'number'
    && typeof (t as ToolRow).days_opened === 'number');
  return { days: row.days, tools };
}

/**
 * Admin-only (English): which tools members opened and finished in the last
 * 30 days (tool_opened / tool_finished events; names only, no content).
 */
export function ToolUsageCard() {
  const { colors } = useTheme();
  const [data, setData] = useState<{ days: number; tools: ToolRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    const { data: raw, error: loadError } = await supabase.rpc('admin_tool_usage', { p_days: 30 });
    if (id !== request.current) return;
    const parsed = parseToolUsage(raw);
    if (loadError || !parsed) setError(loadError?.message ?? 'Unexpected response');
    else setData(parsed);
  }, []);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>Tool usage — last {data?.days ?? 30} days</Text>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.coral }]}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={[styles.head, styles.name, { color: colors.inkSoft }]}>Tool</Text>
            <Text style={[styles.head, styles.num, { color: colors.inkSoft }]}>Opened</Text>
            <Text style={[styles.head, styles.num, { color: colors.inkSoft }]}>Finished</Text>
          </View>
          {data.tools.map((t) => (
            <View key={t.tool} style={styles.row}>
              <Text style={[styles.cell, styles.name, { color: t.members_opened ? colors.ink : colors.inkSoft }]}>{t.tool.replace(/_/g, ' ')}</Text>
              <Text style={[styles.cell, styles.num, { color: colors.ink }]}>{t.members_opened}</Text>
              <Text style={[styles.cell, styles.num, { color: colors.ink }]}>{t.members_finished || '—'}</Text>
            </View>
          ))}
          <Text style={[styles.note, { color: colors.inkSoft }]}>
            Members, counted once per tool. Finished is recorded for tools with a clear end (letter done, practice done,
            brief sent, coaching or provider request sent). Counting started with 4.2 (3); older app versions send nothing.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', paddingVertical: 3 },
  head: { fontSize: 11.5, fontWeight: '700' },
  cell: { fontSize: 13.5 },
  name: { flex: 1 },
  num: { width: 72, textAlign: 'right' },
  note: { fontSize: 12, lineHeight: 17, marginTop: 8 },
});
