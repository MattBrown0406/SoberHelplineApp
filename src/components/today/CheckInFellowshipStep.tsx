import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { CheckIn } from '../../api/types';
import { useAccount } from '../../contexts/AccountContext';
import { useTheme } from '../../contexts/ThemeContext';
import { FELLOWSHIPS, FELLOWSHIP_FINDERS, type Fellowship } from '../../content/fellowshipFinders';
import { PRIMARY_ON_CALL } from '../../content/onCall';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { appAlert } from '../../lib/appAlert';
import {
  EMPTY_FELLOWSHIP_RECORD,
  fellowshipFollowUp,
  fellowshipStepEnded,
  fellowshipStorageKey,
  nextFellowshipStep,
  parseFellowshipRecord,
  parseReachOutResult,
  serializeFellowshipRecord,
  showFellowshipStep,
  type FellowshipEvent,
  type FellowshipRecord,
  type FellowshipStep,
} from '../../lib/checkInFellowship';
import { supabase } from '../../lib/supabase';
import { logToolUsage } from '../../lib/toolUsage';
import { GuidedButton } from './GuidedStartPanel';

/**
 * After a hard check-in: a meeting for families, then (if she says "Not right
 * now") Matt reaching out for a member or help booking for a free account.
 * One calm block inside the feedback card, once per check-in day.
 * Mount with key={account + check-in day} so a new day starts fresh.
 */
export function CheckInFellowshipStep({ checkIn, checkInDay }: { checkIn: CheckIn; checkInDay: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();
  const account = useAccount();
  const accountId = account.user?.id ?? null;
  const isMember = useFeatureAccess('coachMessaging');
  const coach = PRIMARY_ON_CALL.firstName;

  // The device record as read when this block appeared: closing it later this
  // visit keeps the outcome on screen; the next visit finds it closed.
  const [loaded, setLoaded] = useState<FellowshipRecord | null>(null);
  const record = useRef<FellowshipRecord>(EMPTY_FELLOWSHIP_RECORD);
  const [selected, setSelected] = useState<Fellowship | null>(null);
  const [step, setStep] = useState<FellowshipStep>('choose');
  const mounted = useRef(true);
  const sending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    void (async () => {
      let value = EMPTY_FELLOWSHIP_RECORD;
      try {
        value = parseFellowshipRecord(await AsyncStorage.getItem(fellowshipStorageKey(accountId)));
      } catch {
        // Unreadable storage: nothing saved, the step still shows.
      }
      if (!active) return;
      record.current = value;
      setSelected(value.fellowship);
      setLoaded(value);
    })();
    return () => { active = false; };
  }, [accountId]);

  const save = useCallback((change: Partial<FellowshipRecord>) => {
    if (!accountId) return;
    record.current = { ...record.current, ...change };
    void AsyncStorage.setItem(fellowshipStorageKey(accountId), serializeFellowshipRecord(record.current)).catch(() => undefined);
  }, [accountId]);

  const advance = useCallback((event: FellowshipEvent) => {
    setStep((current) => {
      const next = nextFellowshipStep(current, event);
      if (next !== current && fellowshipStepEnded(next)) save({ closedDay: checkInDay });
      return next;
    });
  }, [save, checkInDay]);

  if (!showFellowshipStep({ checkIn, loaded: loaded !== null, closedDay: loaded?.closedDay ?? null, checkInDay })) {
    return null;
  }

  const choose = (fellowship: Fellowship) => {
    setSelected(fellowship);
    save({ fellowship });
  };

  const openFinder = (fellowship: Fellowship) => {
    // Only the tool's name is recorded, never which fellowship.
    logToolUsage('fellowship_finder', 'opened');
    const finder = FELLOWSHIP_FINDERS[fellowship];
    void Linking.openURL(finder.url).catch(() =>
      appAlert(t('fellowships.openErrorTitle'), t('fellowships.openErrorBody', { site: finder.domain })));
  };

  const notNow = () => {
    const settled = !account.isLoading && !account.accountError && !account.isOfflineAccountFallback && account.entitlementsSettled;
    advance({
      type: 'notNow',
      followUp: fellowshipFollowUp({ settled, isAttached: account.isAttached, isAdmin: account.isAdmin, isMember }),
    });
  };

  const requestReachOut = async () => {
    // One request at a time (the server also sends at most one alert a day).
    if (sending.current) return;
    sending.current = true;
    advance({ type: 'send' });
    let ok = false;
    try {
      const { data, error } = await supabase.rpc('request_reach_out');
      ok = !error && parseReachOutResult(data).ok;
    } catch {
      ok = false;
    }
    sending.current = false;
    if (mounted.current) advance({ type: 'sendResult', ok });
  };

  const book = () => {
    advance({ type: 'book' });
    router.push('/book-coaching');
  };

  const text = { color: colors.ink, lineHeight: 22, marginTop: 8 } as const;
  const quiet = { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 8 } as const;

  return (
    <View style={{ borderTopWidth: 1, borderColor: colors.line, marginTop: 16, paddingTop: 8 }}>
      {step === 'choose' && <>
        <Text style={text}>{t('fellowships.intro')}</Text>
        <Text accessibilityRole="header" style={[text, { fontWeight: '700' }]}>{t('fellowships.question')}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('fellowships.question')}>
          {FELLOWSHIPS.map((fellowship) => {
            const checked = selected === fellowship;
            const name = t(`fellowships.options.${fellowship}.name`);
            const description = t(`fellowships.options.${fellowship}.description`);
            return (
              <TouchableOpacity
                key={fellowship}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                accessibilityLabel={`${name}. ${description}`}
                onPress={() => choose(fellowship)}
                activeOpacity={0.8}
                style={{
                  minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8,
                  paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: checked ? 2 : 1,
                  borderColor: checked ? colors.primary : colors.line,
                  backgroundColor: checked ? colors.primaryLight : colors.white,
                }}
              >
                <View style={{
                  width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: checked ? colors.primary : colors.inkSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {checked && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{name}</Text>
                  <Text style={{ color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 2 }}>{description}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        {selected && <>
          <GuidedButton
            label={t('fellowships.find', { name: t(`fellowships.options.${selected}.name`) })}
            hint={t('fellowships.findHint', { name: t(`fellowships.options.${selected}.name`) })}
            onPress={() => openFinder(selected)}
          />
          <Text style={quiet}>{t('fellowships.remembered')}</Text>
        </>}
        <QuietButton label={t('fellowships.notNow')} onPress={notNow} />
      </>}

      {(step === 'reachOut' || step === 'sending' || step === 'failed') && <>
        <Text accessibilityRole="header" style={[text, { fontWeight: '700' }]}>{t('fellowships.reachOut.question', { name: coach })}</Text>
        {step === 'failed' && <Text accessibilityRole="alert" style={text}>{t('fellowships.reachOut.failed')}</Text>}
        <GuidedButton
          label={step === 'sending' ? t('fellowships.reachOut.sending')
            : step === 'failed' ? t('fellowships.reachOut.retry') : t('fellowships.reachOut.yes')}
          disabled={step === 'sending'}
          onPress={() => void requestReachOut()}
        />
        {step !== 'sending' && <QuietButton label={t('fellowships.reachOut.no')} onPress={() => advance({ type: 'decline' })} />}
      </>}

      {step === 'sent' && <>
        <Text accessibilityRole="alert" style={text}>{t('fellowships.reachOut.sent', { name: coach })}</Text>
        <Text style={quiet}>{t('fellowships.reachOut.emergency')}</Text>
      </>}

      {step === 'booking' && <>
        <Text accessibilityRole="header" style={[text, { fontWeight: '700' }]}>{t('fellowships.booking.question')}</Text>
        <GuidedButton label={t('fellowships.booking.yes')} onPress={book} />
        <QuietButton label={t('fellowships.booking.no')} onPress={() => advance({ type: 'decline' })} />
      </>}

      {step === 'closed' && <Text style={text}>{t('fellowships.closing')}</Text>}
    </View>
  );
}

/** "Not right now" / "No thanks": a quiet text button, still 44pt tall. */
function QuietButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} activeOpacity={0.7}
      style={{ minHeight: 44, justifyContent: 'center', marginTop: 4, paddingHorizontal: 4 }}>
      <Text style={{ color: colors.inkSoft, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' }}>{label}</Text>
    </TouchableOpacity>
  );
}
