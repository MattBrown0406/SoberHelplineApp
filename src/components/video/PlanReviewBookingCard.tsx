import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { usePrivateVideoSessions } from '../../hooks/usePrivateVideoSessions';
import { useAccount } from '../../contexts/AccountContext';
import { useAsyncScope } from '../../hooks/useAsyncScope';
import { useTheme } from '../../contexts/ThemeContext';
import { detectedTimeZone, formatInTimeZone } from '../../lib/videoScheduling';
import { buildPlanReviewSnapshot, planReviewSectionKeysForTier, stableStringify, type PlanReviewSectionKey, type PlanReviewSource } from '../../lib/planReview';
import { appAlert } from '../../lib/appAlert';
import { videoErrorText } from '../../lib/videoErrors';
import { DateTimeField } from '../ui/DateTimeField';
import { useCoachingRate } from '../../hooks/useCoachingRate';
import { withAppContext } from '../../lib/websiteLinks';

type Props = { controller: ReturnType<typeof usePrivateVideoSessions>; hasIncludedPlanReview: boolean; source: PlanReviewSource; t: TFunction<'crisis'>; consentLocale: 'en' | 'es'; onUpgrade: () => void };

export function PlanReviewBookingCard(props: Props) {
  const { user } = useAccount();
  return <PlanReviewBookingCardContent key={user?.id ?? 'signed-out'} {...props} />;
}

function PlanReviewBookingCardContent({ controller, hasIncludedPlanReview, source, t, consentLocale, onUpgrade }: Props) {
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { user } = useAccount();
  const { isCurrent } = useAsyncScope(user?.id ?? null);
  // Members are quoted $125 by create-plan-review-checkout; a lapsed member $150.
  const coachingRate = useCoachingRate();
  const isPremier = hasIncludedPlanReview;
  const [selected, setSelected] = useState<PlanReviewSectionKey[]>([]);
  const [purpose, setPurpose] = useState('completeReview');
  const [focus, setFocus] = useState('');
  const [questions, setQuestions] = useState('');
  const [startsAt, setStartsAt] = useState(() => { const d = new Date(Date.now() + 86400000); d.setMinutes(0, 0, 0); return d; });
  const [consented, setConsented] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [consentFingerprint, setConsentFingerprint] = useState<string | null>(null);
  const k = (key: string, options?: Record<string, unknown>) => t(`planReview.${key}`, options);
  const snapshot = useMemo(() => buildPlanReviewSnapshot(source, selected), [source, selected]);
  const snapshotFingerprint = useMemo(() => stableStringify(snapshot), [snapshot]);
  const requestQuestions = useMemo(
    () => questions.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 10),
    [questions],
  );
  const requestFocusReason = `${k(`purposes.${purpose}`)}${focus.trim() ? ` — ${focus.trim()}` : ''}`;
  const requestDetails = useMemo(() => ({
    purpose: requestFocusReason,
    questions: requestQuestions,
    startsAt: startsAt.toISOString(),
    timezone: detectedTimeZone(),
    durationMinutes: 60,
    appointmentType: isPremier ? 'membership_included' : 'one_off_150',
  }), [isPremier, requestFocusReason, requestQuestions, startsAt]);
  const requestFingerprint = useMemo(
    () => stableStringify({ snapshot, requestDetails }),
    [requestDetails, snapshot],
  );
  const existing = controller.activeSession;
  const fingerprint = existing?.booking_purpose === 'plan_review' ? snapshotFingerprint : requestFingerprint;
  const availableSections = planReviewSectionKeysForTier(isPremier);

  useEffect(() => {
    if (!isPremier) setSelected((old) => old.filter((key) => key !== 'familyRoles'));
  }, [isPremier]);

  useEffect(() => {
    if (previewFingerprint && previewFingerprint !== fingerprint) {
      setPreview(false); setPreviewFingerprint(null); setConsented(false); setConsentFingerprint(null);
    }
  }, [fingerprint, previewFingerprint]);

  const toggle = (key: PlanReviewSectionKey) => {
    setSelected((old) => old.includes(key) ? old.filter((item) => item !== key) : [...old, key]);
    setPreview(false); setPreviewFingerprint(null); setConsented(false); setConsentFingerprint(null);
  };
  const togglePreview = () => {
    if (preview) { setPreview(false); return; }
    if (!selected.length) { appAlert(k('checkTitle'), k('selectBeforePreview')); return; }
    setPreview(true); setPreviewFingerprint(fingerprint); setConsented(false); setConsentFingerprint(null);
  };
  const toggleConsent = () => {
    if (!consented && (!preview || previewFingerprint !== fingerprint)) { appAlert(k('checkTitle'), k('previewBeforeConsent')); return; }
    const next = !consented; setConsented(next); setConsentFingerprint(next ? fingerprint : null);
  };
  async function submit() {
    if (!isCurrent() || !user) return;
    if (!selected.length || !consented || !preview || previewFingerprint !== fingerprint || consentFingerprint !== fingerprint || startsAt <= new Date()) { appAlert(k('checkTitle'), k('checkBody')); return; }
    const result = await controller.requestPlanReview({ startsAt, timezone: detectedTimeZone(), durationMinutes: 60, purpose: 'plan_review',
      focusReason: requestFocusReason,
      questions: requestQuestions, selectedSections: selected,
      snapshot: snapshot as unknown as Record<string, unknown>, consentText: k('consent'),
      consentLocale,
      paymentChoice: isPremier ? 'membership_included' : 'one_off_150' });
    if (isCurrent() && result) setPreview(false);
  }

  async function submitRevision() {
    if (!isCurrent() || !user) return;
    if (!existing || !selected.length || !consented || !preview || previewFingerprint !== fingerprint || consentFingerprint !== fingerprint) { appAlert(k('checkTitle'), k('updateCheckBody')); return; }
    const result = await controller.submitPlanReviewRevision(existing, {
      selectedSections: selected, snapshot: snapshot as unknown as Record<string, unknown>,
      consentText: k('consent'), consentLocale,
    });
    if (isCurrent() && result) { setPreview(false); setConsented(false); }
  }

  if (existing?.booking_purpose === 'plan_review') return <View style={[styles.box, { borderColor: colors.primary }]}>
    <Text style={[styles.title, { color: colors.ink }]}>{k('submittedTitle')}</Text>
    <Text style={{ color: colors.inkSoft }}>{existing.appointment_type === 'membership_included' ? k('includedStatus') : k(`payment.${existing.payment_status}`)}</Text>
    <Text style={{ color: colors.inkSoft }}>{k('snapshotTime', { date: existing.snapshot_created_at ? new Date(existing.snapshot_created_at).toLocaleString(locale) : '—' })}</Text>
    {existing.appointment_type === 'one_off_150' && existing.payment_status === 'pending_payment' && isPremier ? (
      // Upgraded to Premier after booking: the review is included, never paid for.
      <>
        <Text style={{ color: colors.ink }}>{k('includedNowBody')}</Text>
        <TouchableOpacity accessibilityRole="button" disabled={controller.mutating} onPress={() => void controller.applyPremierToPlanReview(existing)} style={[styles.submit, { backgroundColor: colors.primary }]}>
          {controller.mutating ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900' }}>{k('applyPremier')}</Text>}
        </TouchableOpacity>
      </>
    ) : existing.appointment_type === 'one_off_150' && existing.payment_status === 'pending_payment' ? (
      <TouchableOpacity accessibilityRole="button" disabled={controller.mutating} onPress={() => void (async () => {
        if (!isCurrent()) return;
        const checkoutUrl = await controller.beginPlanReviewCheckout(existing);
        // null: an error is shown below, or the server found Premier access and
        // made the review included (the card refreshes without a Pay button).
        if (!isCurrent() || !checkoutUrl) return;
        // The website hides membership purchase links for pages opened from the
        // app and may offer "Return to the app". The URL carries a checkout
        // token: never log it.
        const url = withAppContext(checkoutUrl);
        try {
          if (!await Linking.canOpenURL(url)) throw new Error('cannot_open_checkout');
          if (!isCurrent()) return;
          await Linking.openURL(url);
        } catch {
          if (isCurrent()) appAlert(k('checkoutOpenErrorTitle'), k('checkoutOpenErrorBody'));
        }
      })()} style={[styles.submit, { backgroundColor: colors.primary }]}>
        {controller.mutating ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900' }}>{k('payNow', { amount: coachingRate.amount })}</Text>}
      </TouchableOpacity>
    ) : null}
    {controller.planReviewIncluded ? <Text accessibilityRole="alert" style={{ color: colors.green, fontWeight: '700' }}>{k('convertedToIncluded')}</Text> : null}
    {existing.update_requested_at ? <>
      <Text style={{ color: colors.coral, fontWeight: '700' }}>{k('updateRequested')}</Text>
      <Text style={[styles.label, { color: colors.ink }]}>{k('share')}</Text>
      {availableSections.map((key) => <TouchableOpacity key={key} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(key) }} onPress={() => toggle(key)} style={styles.check}><Text style={{ color: colors.primary, fontWeight: '900' }}>{selected.includes(key) ? '☑' : '☐'}</Text><Text style={{ color: colors.ink, flex: 1 }}>{k(`sections.${key}`)}</Text></TouchableOpacity>)}
      <TouchableOpacity onPress={togglePreview} style={[styles.outline, { borderColor: colors.primary }]}><Text style={{ color: colors.primary, fontWeight: '800' }}>{k(preview ? 'hidePreview' : 'previewUpdate')}</Text></TouchableOpacity>
      {preview ? <View style={[styles.preview, { backgroundColor: colors.primaryLight }]}>{Object.entries(snapshot.sections).map(([key, value]) => <View key={key}><Text style={{ color: colors.ink, fontWeight: '800' }}>{k(`sections.${key}`)}</Text><Text selectable style={{ color: colors.inkSoft }}>{JSON.stringify(value, null, 2)}</Text><TouchableOpacity onPress={() => toggle(key as PlanReviewSectionKey)}><Text style={{ color: colors.coral, fontWeight: '700' }}>{k('remove')}</Text></TouchableOpacity></View>)}</View> : null}
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: consented }} onPress={toggleConsent} style={styles.check}><Text style={{ color: colors.primary, fontWeight: '900' }}>{consented ? '☑' : '☐'}</Text><Text style={{ color: colors.ink, flex: 1 }}>{k('consent')}</Text></TouchableOpacity>
      <TouchableOpacity disabled={controller.mutating} onPress={() => void submitRevision()} style={[styles.submit, { backgroundColor: colors.primary }]}>{controller.mutating ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900' }}>{k('submitUpdate')}</Text>}</TouchableOpacity>
    </> : null}
    {controller.error || controller.errorKey ? <Text accessibilityRole="alert" style={{ color: colors.coral }}>{videoErrorText(k, controller.errorKey)}</Text> : null}
  </View>;
  if (existing) return <View style={[styles.box, { borderColor: colors.line }]}>
    <Text style={[styles.title, { color: colors.ink }]}>{k('blockedTitle')}</Text>
    <Text style={[styles.body, { color: colors.inkSoft }]}>{k('blockedBody')}</Text>
  </View>;

  return <View style={[styles.box, { borderColor: colors.line }]}>
    <Text style={[styles.title, { color: colors.ink }]}>{k('title')}</Text>
    <Text style={[styles.body, { color: colors.inkSoft }]}>{isPremier ? k('premierBody') : k('essentialBody', { rate: coachingRate.rate })}</Text>
    {!isPremier ? <TouchableOpacity onPress={onUpgrade} style={[styles.outline, { borderColor: colors.primary }]}><Text style={{ color: colors.primary, fontWeight: '800' }}>{k('upgrade')}</Text></TouchableOpacity> : null}
    <Text style={[styles.label, { color: colors.ink }]}>{k('purpose')}</Text>
    <View style={styles.row}>{['completeReview','boundaries','safety','family'].map((item) => <TouchableOpacity key={item} onPress={() => setPurpose(item)} style={[styles.choice, { borderColor: purpose === item ? colors.primary : colors.line }]}><Text style={{ color: colors.ink }}>{k(`purposes.${item}`)}</Text></TouchableOpacity>)}</View>
    <Text style={[styles.label, { color: colors.ink }]}>{k('share')}</Text>
    {availableSections.map((key) => <TouchableOpacity key={key} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(key) }} onPress={() => toggle(key)} style={styles.check}><Text style={{ color: colors.primary, fontWeight: '900' }}>{selected.includes(key) ? '☑' : '☐'}</Text><Text style={{ color: colors.ink, flex: 1 }}>{k(`sections.${key}`)}</Text></TouchableOpacity>)}
    <TouchableOpacity onPress={togglePreview} style={[styles.outline, { borderColor: colors.primary }]}><Text style={{ color: colors.primary, fontWeight: '800' }}>{k(preview ? 'hidePreview' : 'preview')}</Text></TouchableOpacity>
    {preview ? <View style={[styles.preview, { backgroundColor: colors.primaryLight }]}>
      <Text style={{ color: colors.ink, fontWeight: '900' }}>{k('previewMeetingDetails')}</Text>
      <Text style={{ color: colors.inkSoft }}>{k('previewPurpose', { value: requestFocusReason })}</Text>
      <Text style={{ color: colors.inkSoft }}>{k('previewTime', { value: formatInTimeZone(startsAt, detectedTimeZone(), locale) })}</Text>
      <Text style={{ color: colors.inkSoft }}>{k('previewQuestions', { value: requestQuestions.length ? requestQuestions.join(' · ') : k('none') })}</Text>
      {Object.entries(snapshot.sections).map(([key, value]) => <View key={key}><Text style={{ color: colors.ink, fontWeight: '800' }}>{k(`sections.${key}`)}</Text><Text selectable style={{ color: colors.inkSoft }}>{JSON.stringify(value, null, 2)}</Text><TouchableOpacity onPress={() => toggle(key as PlanReviewSectionKey)}><Text style={{ color: colors.coral, fontWeight: '700' }}>{k('remove')}</Text></TouchableOpacity></View>)}
    </View> : null}
    <Text style={[styles.label, { color: colors.ink }]}>{k('date')}</Text>
    <View style={styles.row}>
      <DateTimeField mode="date" value={startsAt} onChange={setStartsAt} minimumDate={new Date()} label={startsAt.toLocaleDateString(locale)} accessibilityLabel={k('dateField')} />
      <DateTimeField mode="time" value={startsAt} onChange={setStartsAt} minuteInterval={5} label={startsAt.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })} accessibilityLabel={k('timeField')} />
    </View>
    <Text style={{ color: colors.inkSoft }}>{formatInTimeZone(startsAt, detectedTimeZone(), locale)}</Text>
    <TextInput value={focus} onChangeText={setFocus} multiline placeholder={k('focus')} placeholderTextColor={colors.inkSoft} style={[styles.input, { color: colors.ink, borderColor: colors.line }]} />
    <TextInput value={questions} onChangeText={setQuestions} multiline placeholder={k('questions')} placeholderTextColor={colors.inkSoft} style={[styles.input, { color: colors.ink, borderColor: colors.line }]} />
    <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: consented }} onPress={toggleConsent} style={styles.check}><Text style={{ color: colors.primary, fontWeight: '900' }}>{consented ? '☑' : '☐'}</Text><Text style={{ color: colors.ink, flex: 1 }}>{k('consent')}</Text></TouchableOpacity>
    {!isPremier ? <Text style={{ color: colors.coral, fontWeight: '700' }}>{k('pendingPayment')}</Text> : null}
    <TouchableOpacity disabled={controller.mutating} onPress={() => void submit()} style={[styles.submit, { backgroundColor: colors.primary }]}>{controller.mutating ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900' }}>{k('submit')}</Text>}</TouchableOpacity>
    {controller.error || controller.errorKey ? <Text accessibilityRole="alert" style={{ color: colors.coral }}>{videoErrorText(k, controller.errorKey)}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ box:{borderWidth:1,borderRadius:14,padding:14,marginTop:14,gap:8},title:{fontSize:18,fontWeight:'900'},body:{fontSize:13,lineHeight:19},label:{fontSize:13,fontWeight:'800',marginTop:8},row:{flexDirection:'row',flexWrap:'wrap',gap:6},choice:{borderWidth:1,borderRadius:8,padding:8},check:{flexDirection:'row',gap:8,alignItems:'flex-start',paddingVertical:5},outline:{borderWidth:1,borderRadius:9,padding:10,alignItems:'center'},preview:{padding:10,borderRadius:9,gap:10},input:{borderWidth:1,borderRadius:9,minHeight:60,padding:10,textAlignVertical:'top'},submit:{borderRadius:10,padding:13,alignItems:'center'} });
