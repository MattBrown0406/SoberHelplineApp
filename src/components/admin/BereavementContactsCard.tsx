import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';

type ContactRow = { account_id: string; first_name: string | null; last_name: string | null; email: string | null; reported_at: string };

export function parseBereavementContacts(value: unknown): ContactRow[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((row): row is ContactRow => !!row && typeof row === 'object'
    && typeof (row as ContactRow).account_id === 'string' && typeof (row as ContactRow).reported_at === 'string');
}

/**
 * Admin-only (English): members who told us their loved one died and asked
 * for someone to reach out (last 180 days). Empty most of the time.
 */
export function BereavementContactsCard() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    const { data, error: loadError } = await supabase.rpc('admin_bereavement_contacts');
    if (id !== request.current) return;
    const parsed = parseBereavementContacts(data);
    if (loadError || !parsed) setError(loadError?.message ?? 'Unexpected response');
    else setRows(parsed);
  }, []);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>Families who lost someone</Text>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.coral }]}>{error}</Text>
      ) : !rows ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
      ) : rows.length === 0 ? (
        <Text style={[styles.note, { color: colors.inkSoft }]}>No one has asked for a call.</Text>
      ) : (
        rows.map((row) => (
          <View key={row.account_id} style={[styles.row, { borderColor: colors.line }]}>
            <Text style={[styles.name, { color: colors.ink }]}>
              {[row.first_name, row.last_name].filter(Boolean).join(' ') || 'Member'}
            </Text>
            <Text style={[styles.note, { color: colors.inkSoft }]}>
              {row.email ?? 'No email on file'} · told us {new Date(row.reported_at).toLocaleDateString('en-US')}
            </Text>
          </View>
        ))
      )}
      <Text style={[styles.note, { color: colors.inkSoft }]}>
        The member chose "Let Matt know" when telling the app their loved one died. Please reach out personally.
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
});
