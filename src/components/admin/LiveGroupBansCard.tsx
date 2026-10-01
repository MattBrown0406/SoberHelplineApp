import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';
import { appAlert } from '../../lib/appAlert';

type Ban = {
  account_id: string;
  first_name: string | null;
  last_name: string | null;
  room_name: string;
  created_at: string;
};

/** Admin-only: members removed from a live group, who cannot rejoin until let back in. */
export function LiveGroupBansCard() {
  const { colors } = useTheme();
  const [bans, setBans] = useState<Ban[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [lifting, setLifting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_live_group_bans');
    setFailed(!!error);
    setBans(error ? [] : ((data ?? []) as Ban[]));
  }, []);

  useEffect(() => { void load(); }, [load]);

  function allowBack(ban: Ban) {
    const name = [ban.first_name, ban.last_name].filter(Boolean).join(' ') || 'This member';
    appAlert('Allow back into live groups?', `${name} will be able to join live groups again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Allow back',
        onPress: async () => {
          setLifting(ban.account_id);
          const { error } = await supabase.rpc('admin_lift_live_group_ban', { p_account_id: ban.account_id });
          setLifting(null);
          if (error) appAlert('Could not update', error.message);
          else void load();
        },
      },
    ]);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>Removed from live groups</Text>
      {bans === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : failed ? (
        <Text style={[styles.note, { color: colors.coral }]}>Could not load removed members.</Text>
      ) : bans.length === 0 ? (
        <Text style={[styles.note, { color: colors.inkSoft }]}>Nobody has been removed.</Text>
      ) : (
        bans.map((ban) => (
          <View key={ban.account_id} style={[styles.row, { borderTopColor: colors.line }]}>
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: colors.ink }]}>
                {[ban.first_name, ban.last_name].filter(Boolean).join(' ') || 'Member'}
              </Text>
              <Text style={[styles.note, { color: colors.inkSoft }]}>
                Removed from {ban.room_name} · {new Date(ban.created_at).toLocaleDateString()}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Allow back into live groups"
              disabled={lifting === ban.account_id}
              onPress={() => allowBack(ban)}
              style={[styles.button, { borderColor: colors.primary }]}
            >
              {lifting === ban.account_id
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={[styles.buttonText, { color: colors.primary }]}>Allow back</Text>}
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 20, marginBottom: 20 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingVertical: 10 },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 18 },
  button: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  buttonText: { fontSize: 13, fontWeight: '800' },
});
