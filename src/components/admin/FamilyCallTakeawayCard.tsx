import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';
import { appAlert } from '../../lib/appAlert';

type Takeaway = { meeting_date: string; body: string | null; live_meeting_date: string; live_body: string | null };

const MAX_LENGTH = 280;

function isTakeaway(value: unknown): value is Takeaway {
  const row = value as Record<string, unknown> | null;
  return !!row && typeof row.meeting_date === 'string' && typeof row.live_meeting_date === 'string';
}

function mondayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/**
 * Admin-only (English): "This week's one thing" for The Family Squares. It
 * shows on members' Today from the call's start until the next call, and the
 * Tuesday note (1 AM Pacific) quotes it. Without one, Today shows each
 * member's own week's practice.
 */
export function FamilyCallTakeawayCard() {
  const { colors } = useTheme();
  const [state, setState] = useState<Takeaway | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setError(null);
    const { data, error: loadError } = await supabase.rpc('admin_get_family_call_takeaway');
    if (id !== request.current) return;
    if (loadError || !isTakeaway(data)) {
      setError(loadError?.message ?? 'Unexpected response');
      return;
    }
    setState(data);
    setDraft(data.body ?? '');
  }, []);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  const save = async (body: string) => {
    setSaving(true);
    const { error: saveError } = await supabase.rpc('admin_set_family_call_takeaway', { p_body: body });
    setSaving(false);
    if (saveError) {
      appAlert('Not saved', saveError.message);
      return;
    }
    await load();
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>This week&apos;s one thing</Text>
      {error && !state ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.coral }]}>{error}</Text>
      ) : !state ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
      ) : (
        <>
          <Text style={[styles.note, { color: colors.inkSoft }]}>
            For the Monday {mondayLabel(state.meeting_date)} call. One line families can try this week. It shows on Today
            once the call starts, and Tuesday&apos;s note (sent from 1 AM Pacific) quotes it.
          </Text>
          <TextInput
            style={[styles.input, { color: colors.ink, borderColor: colors.line }]}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={MAX_LENGTH}
            placeholder="e.g. Hold one limit for seven days, and only that one."
            placeholderTextColor={colors.inkSoft}
          />
          <Text style={[styles.note, { color: colors.inkSoft }]}>{draft.trim().length}/{MAX_LENGTH}</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary, opacity: saving || !draft.trim() ? 0.6 : 1 }]}
              disabled={saving || !draft.trim()}
              onPress={() => void save(draft)}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
            </TouchableOpacity>
            {state.body ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnOutline, { borderColor: colors.line }]}
                disabled={saving}
                onPress={() => void save('')}
              >
                <Text style={[styles.btnText, { color: colors.ink }]}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={[styles.note, { color: colors.inkSoft, marginTop: 10 }]}>
            Members see now: {state.live_body ? `"${state.live_body}" (Monday ${mondayLabel(state.live_meeting_date)} call)` : 'their own week\'s practice (nothing written for the last call).'}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 14.5, minHeight: 72, marginTop: 10, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnOutline: { borderWidth: 1, backgroundColor: 'transparent' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
