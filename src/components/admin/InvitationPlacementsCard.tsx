import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';
import { invitationPlacementRows, placementLabel, type PlacementRow } from './invitationPlacements';

/**
 * Admin-only (English), inside the membership path: which invitation moments
 * work. Reads the membership-path events directly (admins may read
 * funnel_events); the last 30 days, one count per member.
 */
export function InvitationPlacementsCard({ viewerId }: { viewerId: string | null }) {
  const { colors } = useTheme();
  const [rows, setRows] = useState<PlacementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error: loadError } = await supabase
      .from('funnel_events')
      .select('account_id, stage, metadata')
      .in('stage', ['membership_invite_shown', 'membership_invite_tapped', 'purchase_succeeded'])
      .gte('created_at', since)
      .limit(10000);
    if (id !== request.current) return;
    if (loadError) setError(loadError.message);
    else setRows(invitationPlacementRows(data, viewerId));
  }, [viewerId]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.subhead, { color: colors.ink }]}>Invitations by place — last 30 days</Text>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.coral }]}>{error}</Text>
      ) : !rows ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 4 }} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={[styles.head, styles.name, { color: colors.inkSoft }]}>Place</Text>
            <Text style={[styles.head, styles.num, { color: colors.inkSoft }]}>Shown</Text>
            <Text style={[styles.head, styles.num, { color: colors.inkSoft }]}>Tapped</Text>
            <Text style={[styles.head, styles.num, { color: colors.inkSoft }]}>Joined</Text>
          </View>
          {rows.map((row) => (
            <View key={row.source} style={styles.row}>
              <Text style={[styles.cell, styles.name, { color: row.shown ? colors.ink : colors.inkSoft }]}>{placementLabel(row.source)}</Text>
              <Text style={[styles.cell, styles.num, { color: colors.ink }]}>{row.shown}</Text>
              <Text style={[styles.cell, styles.num, { color: colors.ink }]}>{row.tapped}</Text>
              <Text style={[styles.cell, styles.num, { color: colors.ink }]}>{row.subscribed}</Text>
            </View>
          ))}
          <Text style={[styles.note, { color: colors.inkSoft }]}>
            Members, each counted once per column. Joined = subscribed in the App Store with that place as where they came
            from. Your own account is left out; other admins testing are not. Five-day streak and finishing a tool start
            with 4.4; older app versions never show them.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  subhead: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', paddingVertical: 3 },
  head: { fontSize: 11.5, fontWeight: '700' },
  cell: { fontSize: 13 },
  name: { flex: 1 },
  num: { width: 56, textAlign: 'right' },
  note: { fontSize: 12, lineHeight: 17, marginTop: 6 },
});
