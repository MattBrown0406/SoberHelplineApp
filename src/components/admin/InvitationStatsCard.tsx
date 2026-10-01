import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { fetchAdminInvitationStats } from '../../lib/invitationApi';
import { parseAdminInvitationStats, type AdminInvitationStats } from '../../lib/invitationAdminStats';

/**
 * Admin-only Invitation Engine reporting (English; backed by the admin-gated
 * admin_invitation_stats() RPC). Self-contained: mount as <InvitationStatsCard />.
 * Bump `refreshKey` to refetch alongside the rest of the dashboard.
 */
export function InvitationStatsCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { colors } = useTheme();
  const [stats, setStats] = useState<AdminInvitationStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const parsed = parseAdminInvitationStats(await fetchAdminInvitationStats());
      if (id !== request.current) return;
      if (!parsed) throw new Error('Unexpected response');
      setStats(parsed);
    } catch (loadError) {
      if (id === request.current) setError(loadError instanceof Error ? loadError.message : 'Could not load');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load, refreshKey]);

  if (error && !stats) {
    return (
      <View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.coral }]}>
        <Text style={[styles.title, { color: colors.coral }]}>Invitation Engine analytics unavailable</Text>
        <Text style={[styles.note, { color: colors.inkSoft }]}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => { void load(); }} style={styles.refresh}>
          <Text style={[styles.refreshText, { color: colors.primary }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.ink }]}>Invitation Engine</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh invitation stats" onPress={() => { void load(); }} style={styles.refresh}>
          <Text style={[styles.refreshText, { color: colors.primary }]}>Refresh</Text>
        </TouchableOpacity>
      </View>
      {!stats ? (
        loading ? <ActivityIndicator color={colors.primary} /> : null
      ) : (
        <>
          <View style={styles.row}>
            <Stat label="Families using" value={String(stats.familiesUsing)} />
            <Stat label="Invitations" value={String(stats.asks)} />
            <Stat label="Yes rate" value={stats.yesRate === null ? '—' : `${Math.round(stats.yesRate * 100)}%`} />
            <Stat label="Median days to yes" value={stats.medianDaysToYes === null ? '—' : String(stats.medianDaysToYes)} />
          </View>
          <Text style={[styles.line, { color: colors.inkSoft }]}>
            Outcomes: {stats.outcomes.yes} yes · {stats.outcomes.notYet} not yet · {stats.outcomes.angry} angry · {stats.outcomes.didntGetToIt} didn&apos;t get to it
          </Text>
          <Text style={[styles.line, { color: colors.inkSoft }]}>
            {stats.profilesMapped} pattern maps · {stats.familiesWithYes} families reached yes · {stats.windowPushOptIns} window-alert opt-ins · {stats.movesDone} moves done
          </Text>

          <Text style={[styles.subhead, { color: colors.ink }]}>Last 30 days (vs prior 30)</Text>
          <View style={styles.row}>
            <Trend label="Invitations" now={stats.last30.attempts} before={stats.prior30.attempts} />
            <Trend label="Yes" now={stats.last30.yes} before={stats.prior30.yes} />
            <Trend label="Active families" now={stats.last30.activeFamilies} before={stats.prior30.activeFamilies} />
            <Trend label="New families" now={stats.last30.newFamilies} before={stats.prior30.newFamilies} />
          </View>

          <View style={styles.weeks} accessibilityLabel="Weekly invitations and yeses, last five weeks">
            {stats.weekly.map((week) => {
              const max = Math.max(1, ...stats.weekly.map((item) => item.attempts));
              return (
                <View key={week.weekStart} style={styles.week}>
                  <View style={styles.barTrack}>
                    <View style={[styles.bar, { height: `${Math.round((week.attempts / max) * 100)}%`, backgroundColor: colors.primaryLight }]}>
                      {week.yes > 0 && (
                        <View style={[styles.barYes, { height: `${Math.round((week.yes / Math.max(1, week.attempts)) * 100)}%`, backgroundColor: colors.green }]} />
                      )}
                    </View>
                  </View>
                  <Text style={[styles.weekLabel, { color: colors.inkSoft }]}>{week.weekStart.slice(5)}</Text>
                  <Text style={[styles.weekLabel, { color: colors.ink }]}>{week.attempts}/{week.yes}</Text>
                </View>
              );
            })}
          </View>

          <Text style={[styles.subhead, { color: colors.ink }]}>Recent yes — reach out within the hour</Text>
          {stats.recentYes.length === 0 ? (
            <Text style={[styles.note, { color: colors.inkSoft }]}>No yeses in the last 14 days.</Text>
          ) : stats.recentYes.map((item) => (
            <View key={item.id} style={[styles.yesRow, { borderBottomColor: colors.line }]}>
              <Text style={[styles.yesName, { color: colors.ink }]}>{item.name || 'Member'}</Text>
              <Text style={[styles.note, { color: colors.inkSoft }]}>
                {item.email ?? 'no email'} · {new Date(item.createdAt).toLocaleString()}
              </Text>
            </View>
          ))}
          <Text style={[styles.note, { color: colors.inkSoft }]}>
            Families = family spaces (or solo accounts) that finished setup. Yes rate counts real invitations only (not &quot;didn&apos;t get to it&quot;). Median days runs from a family&apos;s setup to its first yes.
          </Text>
        </>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.inkSoft }]}>{label}</Text>
    </View>
  );
}

function Trend({ label, now, before }: { label: string; now: number; before: number }) {
  const { colors } = useTheme();
  const delta = now - before;
  const sign = delta > 0 ? '+' : '';
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.ink }]}>{now}</Text>
      <Text style={[styles.statLabel, { color: delta > 0 ? colors.green : delta < 0 ? colors.coral : colors.inkSoft }]}>
        {label} ({sign}{delta})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 20, marginBottom: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  refresh: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  refreshText: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginBottom: 10 },
  stat: { alignItems: 'flex-start', minWidth: 90 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, marginTop: 2 },
  line: { fontSize: 13, lineHeight: 19, marginBottom: 6 },
  subhead: { fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  weeks: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', marginTop: 6 },
  week: { flex: 1, alignItems: 'center' },
  barTrack: { height: 60, width: 22, justifyContent: 'flex-end' },
  bar: { width: 22, borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden', minHeight: 2 },
  barYes: { width: 22 },
  weekLabel: { fontSize: 10.5, marginTop: 3 },
  yesRow: { paddingVertical: 8, borderBottomWidth: 1 },
  yesName: { fontSize: 14.5, fontWeight: '700' },
  note: { fontSize: 11.5, lineHeight: 17, marginTop: 4 },
});
