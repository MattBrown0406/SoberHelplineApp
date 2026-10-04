import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { supabase } from '../src/lib/supabase';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';
import { formatInTimeZone } from '../src/lib/videoScheduling';
import { useWebSSO } from '../src/hooks/useWebSSO';
import { useCoachingRate } from '../src/hooks/useCoachingRate';
import { WEBSITE_PATHS, withAppContext } from '../src/lib/websiteLinks';
import { COACHING_MEMBER_PRICE, COACHING_STANDARD_PRICE } from '../src/lib/coachingPrice';

interface Booking {
  id: string;
  preferred_times: string;
  status: string;
  payment_status: string;
  scheduled_at: string | null;
  zoom_url: string | null;
}

const TIME_PERIOD_KEYS = ['morning', 'afternoon', 'evening'] as const;
type TimePeriodKey = typeof TIME_PERIOD_KEYS[number];

function getNextDays(count: number): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d;
  });
}

function formatDateChip(d: Date, language: string): string {
  return d.toLocaleDateString(language.startsWith('es') ? 'es' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A confirmed coaching time in the member's own timezone (not the device's raw UTC string). */
function formatBookingTime(value: string, timeZone: string | undefined, language: string): string {
  const locale = language.startsWith('es') ? 'es' : 'en-US';
  try {
    return formatInTimeZone(value, timeZone || 'UTC', locale);
  } catch {
    return new Date(value).toLocaleString(locale);
  }
}

export default function BookCoachingScreen() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('support');
  const { user } = useAccount();
  const router = useRouter();
  const { openWithSSO } = useWebSSO();
  const coachingRate = useCoachingRate();
  // soberhelpline.com/app/coaching/booked returns here after a website booking.
  const { booked } = useLocalSearchParams<{ booked?: string }>();
  const showBooked = booked === '1';

  const dates = getNextDays(14);

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriodKey | null>(null);
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadError, setLoadError] = useState(false);
  const loadRequest = useRef(0);
  const submissionScope = useRef({ accountId: user?.id });
  if (submissionScope.current.accountId !== user?.id) {
    submissionScope.current = { accountId: user?.id };
  }

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    if (!user?.id) return;
    setLoadError(false);
    try {
      // Plan-review payment records live on the plan-review card (Crisis Mode)
      // with their real status; the RPC leaves them out of this list.
      const { data, error } = await supabase.rpc('member_get_coaching_bookings', { p_limit: 10 });
      if (error) throw error;
      if (request === loadRequest.current) setBookings((data as Booking[]) ?? []);
    } catch {
      if (request === loadRequest.current) setLoadError(true);
    }
  }, [user?.id]);

  useEffect(() => {
    const scope = { accountId: user?.id };
    submissionScope.current = scope;
    setSubmitted(false);
    setSubmitting(false);
    setSubmitError(false);
    setSelectedDate(null);
    setSelectedPeriod(null);
    setContact('');
    setNote('');
    setBookings([]);
    void load();
    return () => {
      ++loadRequest.current;
      if (submissionScope.current === scope) submissionScope.current = { accountId: undefined };
    };
  }, [load]);

  const canSubmit = selectedDate !== null && selectedPeriod !== null;

  // The real booking: open time slots and PayPal checkout on soberhelpline.com,
  // in the system browser (Safari), signed in so members get the $125 price.
  const [openingBooking, setOpeningBooking] = useState(false);
  const [bookingOpenError, setBookingOpenError] = useState(false);
  async function openWebsiteBooking() {
    if (openingBooking) return;
    setOpeningBooking(true);
    setBookingOpenError(false);
    const opened = await openWithSSO(user?.id ?? null, WEBSITE_PATHS.bookConsultation);
    setOpeningBooking(false);
    if (!opened) setBookingOpenError(true);
  }

  async function handleSubmit() {
    if (!user || !canSubmit || submitting) return;
    const scope = submissionScope.current;
    if (scope.accountId !== user.id) return;
    setSubmitting(true);
    setSubmitted(false);
    setSubmitError(false);

    const dateStr = formatDateChip(selectedDate!, i18n.language);
    const periodStr = t(`coaching.${selectedPeriod}` as const);
    const preferredTimes = `${dateStr} · ${periodStr}`;

    const combinedNote = [
      contact.trim() ? t('coaching.contactNotePrefix', { contact: contact.trim() }) : null,
      note.trim() || null,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const { error } = await supabase.from('coaching_bookings').insert({
        account_id: user.id,
        preferred_times: preferredTimes,
        note: combinedNote || null,
      });
      if (error) throw error;
      if (submissionScope.current !== scope) return;
      setSubmitted(true);
      setSelectedDate(null);
      setSelectedPeriod(null);
      setContact('');
      setNote('');
      void load();
    } catch {
      if (submissionScope.current === scope) setSubmitError(true);
    } finally {
      if (submissionScope.current === scope) setSubmitting(false);
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
        <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/support'); }} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={[styles.headerTitle, { color: colors.ink }]}>
            {t('coaching.title')}
          </Text>
          <Text style={[styles.headerSub, { color: colors.inkSoft }]}>
            {t('coaching.subtitle', { rate: coachingRate.hourly })}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {showBooked && (
          <View accessibilityRole="alert" style={[styles.successBox, { backgroundColor: colors.greenLight }]}>
            <Text accessibilityRole="header" style={[styles.bookedTitle, { color: colors.green }]}>
              {t('coaching.bookedTitle')}
            </Text>
            <Text style={[styles.successText, { color: colors.ink }]}>{t('coaching.bookedBody')}</Text>
          </View>
        )}

        <View style={[styles.bookCard, { borderColor: colors.primary, backgroundColor: colors.white }]}>
          <Text accessibilityRole="header" style={[styles.bookTitle, { color: colors.ink }]}>
            {t('coaching.bookTitle')}
          </Text>
          <Text style={[styles.bodyText, { color: colors.inkSoft, marginBottom: 10 }]}>
            {t('coaching.bookBody')}
          </Text>
          <Text style={[styles.bookPrice, { color: colors.ink }]}>
            {coachingRate.member
              ? t('coaching.bookPriceMember', { price: COACHING_MEMBER_PRICE, standard: COACHING_STANDARD_PRICE })
              : t('coaching.bookPriceStandard', { price: COACHING_STANDARD_PRICE, memberPrice: COACHING_MEMBER_PRICE })}
          </Text>
          {!user && (
            <Text style={[styles.bodyText, { color: colors.inkSoft, marginBottom: 10 }]}>
              {t('coaching.bookSignedOut')}
            </Text>
          )}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => void openWebsiteBooking()}
            disabled={openingBooking}
            accessibilityRole="link"
            accessibilityLabel={t('coaching.bookButton')}
            accessibilityHint={t('coaching.bookButtonHint')}
            accessibilityState={{ busy: openingBooking, disabled: openingBooking }}
            activeOpacity={0.85}
          >
            {openingBooking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('coaching.bookButton')}</Text>
            )}
          </TouchableOpacity>
          {bookingOpenError && (
            <Text accessibilityRole="alert" style={[styles.bodyText, { color: colors.coral, marginTop: 10, marginBottom: 0 }]}>
              {t('coaching.bookOpenError')}
            </Text>
          )}
        </View>

        {/* Secondary: a request Matt follows up by hand (coaching_bookings). */}
        <Text accessibilityRole="header" style={[styles.requestTitle, { color: colors.ink }]}>
          {t('coaching.requestTitle')}
        </Text>
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

        {submitError && (
          <Text accessibilityRole="alert" style={[styles.bodyText, { color: colors.coral }]}>
            {t('coaching.submitError')}
          </Text>
        )}

        {/* Date picker */}
        <Text style={[styles.label, { color: colors.ink }]}>{t('coaching.dateLabel')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {dates.map((d, i) => {
            const isSelected = selectedDate?.toDateString() === d.toDateString();
            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.chip,
                  { borderColor: isSelected ? colors.primary : colors.line },
                  isSelected && { backgroundColor: colors.primary },
                ]}
                onPress={() => setSelectedDate(d)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipText, { color: isSelected ? '#fff' : colors.ink }]}>
                  {formatDateChip(d, i18n.language)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Time period picker */}
        <Text style={[styles.label, { color: colors.ink, marginTop: 16 }]}>
          {t('coaching.timePeriodLabel')}
        </Text>
        <View style={styles.periodRow}>
          {TIME_PERIOD_KEYS.map((key) => {
            const isSelected = selectedPeriod === key;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.periodChip,
                  { borderColor: isSelected ? colors.primary : colors.line },
                  isSelected && { backgroundColor: colors.primary },
                ]}
                onPress={() => setSelectedPeriod(key)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipText, { color: isSelected ? '#fff' : colors.ink }]}>
                  {t(`coaching.${key}` as const)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.confirmNote, { color: colors.inkSoft }]}>
          {t('coaching.confirmNote')}
        </Text>

        {/* Contact */}
        <Text style={[styles.label, { color: colors.ink, marginTop: 16 }]}>
          {t('coaching.contactLabel')}
        </Text>
        <TextInput
          style={[styles.input, styles.inputSingle, { borderColor: colors.line, color: colors.ink }]}
          placeholder={t('coaching.contactPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          value={contact}
          onChangeText={setContact}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        {/* Focus note */}
        <Text style={[styles.label, { color: colors.ink }]}>{t('coaching.noteLabel')}</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
          placeholder={t('coaching.notePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          value={note}
          onChangeText={setNote}
          multiline
        />

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { backgroundColor: canSubmit ? colors.primary : colors.line },
          ]}
          onPress={handleSubmit}
          disabled={submitting || !canSubmit}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{t('coaching.submitButton')}</Text>
          )}
        </TouchableOpacity>
        <Text style={[styles.paymentNote, { color: colors.inkSoft }]}>
          {t('coaching.paymentNote', { rate: coachingRate.hourly })}
        </Text>

        {loadError && (
          <View>
            <Text accessibilityRole="alert" style={[styles.bodyText, { color: colors.coral }]}>
              {t('coaching.loadError')}
            </Text>
            <TouchableOpacity onPress={() => void load()} accessibilityRole="button">
              <Text style={[styles.label, { color: colors.primary }]}>{t('common:accountLoad.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

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
                      ? formatBookingTime(b.scheduled_at, user?.timezone, i18n.language)
                      : b.preferred_times}
                  </Text>
                  <Text style={[styles.bookingStatus, { color: colors.inkSoft }]}>
                    {statusLabel(b)}
                  </Text>
                </View>
                {b.status === 'confirmed' && b.zoom_url ? (
                  <TouchableOpacity
                    style={[styles.joinBtn, { backgroundColor: colors.green }]}
                    onPress={() => Linking.openURL(withAppContext(b.zoom_url!))}
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
  label: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  chipScroll: { marginBottom: 4 },
  chip: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  periodRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  periodChip: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 16,
    flex: 1,
    alignItems: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '500' },
  confirmNote: { fontSize: 12, marginTop: 10, marginBottom: 4 },
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
  inputSingle: { minHeight: 0 },
  primaryBtn: { borderRadius: 99, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  paymentNote: { fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 10, marginBottom: 20 },
  successBox: { borderRadius: 12, padding: 14, marginBottom: 16 },
  successText: { fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  bookedTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  bookCard: { borderWidth: 1.5, borderRadius: 18, padding: 16, marginBottom: 24 },
  bookTitle: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  bookPrice: { fontSize: 14, fontWeight: '700', lineHeight: 20, marginBottom: 12 },
  requestTitle: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 16, borderWidth: 1 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 },
  bookingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, gap: 8 },
  bookingInfo: { flex: 1 },
  bookingTimes: { fontSize: 13.5, fontWeight: '600' },
  bookingStatus: { fontSize: 12, marginTop: 2 },
  joinBtn: { borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  joinBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
