import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { supabase } from '../src/lib/supabase';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';
import { COACHING_PAYMENT_URL, COACHING_RATE_LABEL } from '../src/config';

interface Booking {
  id: string;
  preferred_times: string;
  status: string;
  payment_status: string;
  scheduled_at: string | null;
  zoom_url: string | null;
}

export default function BookCoachingScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { user } = useAccount();
  const router = useRouter();

  const [times, setTimes] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('coaching_bookings')
      .select('id, preferred_times, status, payment_status, scheduled_at, zoom_url')
      .order('created_at', { ascending: false })
      .limit(10);
    setBookings((data as Booking[]) ?? []);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function handleSubmit() {
    if (!user || !times.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from('coaching_bookings').insert({
      account_id: user.id,
      preferred_times: times.trim(),
      note: note.trim() || null,
    });
    setSubmitting(false);
    if (!error) {
      setSubmitted(true);
      setTimes('');
      setNote('');
      load();
      Linking.openURL(COACHING_PAYMENT_URL);
    }
  }

  function statusLabel(b: Booking): string {
    if (b.status === 'confirmed') return t('coaching.statusConfirmed');
    if (b.status === 'completed') return t('coaching.statusCompleted');
    if (b.status === 'cancelled') return t('coaching.statusCancelled');
    return b.payment_status === 'paid'
      ? t('coaching.statusPaidPending')
      : t('coaching.statusRequested');
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={[styles.headerTitle, { color: colors.ink }]}>
            {t('coaching.title')}
          </Text>
          <Text style={[styles.headerSub, { color: colors.inkSoft }]}>
            {t('coaching.subtitle', { rate: COACHING_RATE_LABEL })}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.bodyText, { color: colors.inkSoft }]}>
          {t('coaching.description')}
        </Text>

        {submitted && (
          <View style={[styles.successBox, { backgroundColor: colors.greenLight }]}>
            <Text style={[styles.successText, { color: colors.green }]}>
              {t('coaching.submitted')}
            </Text>
          </View>
        )}

        <Text style={[styles.label, { color: colors.ink }]}>
          {t('coaching.timesLabel')}
        </Text>
        <TextInput
          style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
          placeholder={t('coaching.timesPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          value={times}
          onChangeText={setTimes}
          multiline
        />

        <Text style={[styles.label, { color: colors.ink }]}>
          {t('coaching.noteLabel')}
        </Text>
        <TextInput
          style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
          placeholder={t('coaching.notePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          value={note}
          onChangeText={setNote}
          multiline
        />

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={handleSubmit}
          disabled={submitting || !times.trim()}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {t('coaching.submitButton', { rate: COACHING_RATE_LABEL })}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={[styles.paymentNote, { color: colors.inkSoft }]}>
          {t('coaching.paymentNote')}
        </Text>

        {bookings.length > 0 && (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
              {t('coaching.myBookings')}
            </Text>
            {bookings.map((b) => (
              <View key={b.id} style={[styles.bookingRow, { borderBottomColor: colors.line }]}>
                <View style={styles.bookingInfo}>
                  <Text style={[styles.bookingTimes, { color: colors.ink }]} numberOfLines={1}>
                    {b.scheduled_at
                      ? new Date(b.scheduled_at).toLocaleString()
                      : b.preferred_times}
                  </Text>
                  <Text style={[styles.bookingStatus, { color: colors.inkSoft }]}>
                    {statusLabel(b)}
                  </Text>
                </View>
                {b.status === 'confirmed' && b.zoom_url ? (
                  <TouchableOpacity
                    style={[styles.joinBtn, { backgroundColor: colors.green }]}
                    onPress={() => Linking.openURL(b.zoom_url!)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.joinBtnText}>{t('sessions.joinZoom')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: '#fff',
  },
  back: { fontSize: 30, fontWeight: '600', marginTop: -4 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerSub: { fontSize: 11.5, marginTop: 1 },
  content: { padding: 20, paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH },
  bodyText: { fontSize: 13.5, lineHeight: 20, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 13,
    fontSize: 14,
    minHeight: 64,
    marginBottom: 14,
    textAlignVertical: 'top',
  },
  primaryBtn: { borderRadius: 99, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  paymentNote: { fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 10, marginBottom: 20 },
  successBox: { borderRadius: 12, padding: 14, marginBottom: 16 },
  successText: { fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  bookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  bookingInfo: { flex: 1 },
  bookingTimes: { fontSize: 13.5, fontWeight: '600' },
  bookingStatus: { fontSize: 12, marginTop: 2 },
  joinBtn: { borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  joinBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
