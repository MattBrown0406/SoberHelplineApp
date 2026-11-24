import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { appAlert } from '../../lib/appAlert';
import { supabase } from '../../lib/supabase';

export type ReachOutRow = {
  id: string;
  account_id: string;
  first_name: string | null;
  email: string | null;
  created_at: string;
  handled_at: string | null;
};

export function parseReachOutRequests(value: unknown): ReachOutRow[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((row): row is ReachOutRow => !!row && typeof row === 'object'
    && typeof (row as ReachOutRow).id === 'string'
    && typeof (row as ReachOutRow).account_id === 'string'
    && typeof (row as ReachOutRow).created_at === 'string');
}

/** "just now", "12 min ago", "3 h ago", "2 days ago" (English, staff only). */
export function reachOutAge(createdAt: string, nowMs: number): string {
  const ms = nowMs - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * Admin-only (English): members who, after a hard check-in on Today, asked
 * Matt to reach out. Open requests only; "Done" marks one handled. A push
 * (kind admin_reach_out) opens Admin, where this card sits first.
 */
export function ReachOutRequestsCard() {
  const { colors } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<ReachOutRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    const { data, error: loadError } = await supabase.rpc('admin_reach_out_requests', { p_open_only: true });
    if (id !== request.current) return;
    const parsed = parseReachOutRequests(data);
    if (loadError || !parsed) setError(loadError?.message ?? 'Unexpected response');
    else { setError(null); setRows(parsed); }
  }, []);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  async function message(row: ReachOutRow) {
    setBusy(row.id);
    const { data: threadId, error: threadError } = await supabase.rpc('admin_get_or_create_thread', { p_account_id: row.account_id });
    setBusy(null);
    if (threadError || typeof threadId !== 'string') {
      appAlert('Could not open a conversation', threadError?.message ?? 'Try again.');
      return;
    }
    router.push({ pathname: '/admin-thread' as never, params: { threadId } });
  }

  async function done(row: ReachOutRow) {
    setBusy(row.id);
    const { error: markError } = await supabase.rpc('admin_mark_reach_out_handled', { p_id: row.id });
    setBusy(null);
    if (markError) appAlert('Could not mark it done', markError.message);
    else void load();
  }

  const now = Date.now();
  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>Asked you to reach out</Text>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.coral }]}>{error}</Text>
      ) : !rows ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
      ) : rows.length === 0 ? (
        <Text style={[styles.note, { color: colors.inkSoft }]}>No one is waiting.</Text>
      ) : (
        rows.map((row) => (
          <View key={row.id} style={[styles.row, { borderColor: colors.line }]}>
            <Text style={[styles.name, { color: colors.ink }]}>{row.first_name?.trim() || 'Member'}</Text>
            <Text style={[styles.note, { color: colors.inkSoft }]}>
              Asked {reachOutAge(row.created_at, now)}{row.email ? ` · ${row.email}` : ''}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy === row.id }}
                disabled={busy === row.id} onPress={() => void message(row)}
                style={[styles.action, { backgroundColor: colors.primary }]}>
                <Text style={[styles.actionText, { color: '#fff' }]}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy === row.id }}
                disabled={busy === row.id} onPress={() => void done(row)}
                style={[styles.action, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.actionText, { color: colors.primary }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
      <Text style={[styles.note, { color: colors.inkSoft }]}>
        From the check-in card on Today: the member said "Not right now" to a meeting and asked you to reach out. Please reach out personally, then tap Done.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  row: { borderTopWidth: 1, paddingVertical: 8 },
  name: { fontSize: 14, fontWeight: '700' },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: { minHeight: 44, borderRadius: 99, paddingHorizontal: 18, justifyContent: 'center' },
  actionText: { fontSize: 14, fontWeight: '700' },
});
