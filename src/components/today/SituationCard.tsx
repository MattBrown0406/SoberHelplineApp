import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { DOOR_COPY_KEY, DOOR_ROUTE, type FunnelDoor } from '../../lib/situation';
import type { FreeCall } from '../../hooks/useTodayFeed';

interface Props {
  nextFreeCall: FreeCall | null;
  primaryDoor: FunnelDoor;
  onRsvp: () => void;
}

/**
 * Today's lead card. The free Monday call is the daily anchor; below it, when
 * the family's situation warrants it, a higher-intent door (coaching or
 * intervention) is offered. The free call is never gated — it's the entry rung.
 */
export function SituationCard({ nextFreeCall, primaryDoor, onRsvp }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();

  const title = nextFreeCall?.title ?? t('situationCta.freeCallTitle');
  const schedule = nextFreeCall?.schedule_label ?? t('situationCta.scheduleFallback');
  const canJoin = nextFreeCall?.rsvped && nextFreeCall?.zoom_url;
  const doorRoute = DOOR_ROUTE[primaryDoor];

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('situationCta.eyebrow')}</Text>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.schedule, { color: colors.inkSoft }]}>{schedule}</Text>

      {canJoin ? (
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => void Linking.openURL(nextFreeCall!.zoom_url!)}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{t('situationCta.join')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            {
              backgroundColor: nextFreeCall?.rsvped ? colors.greenLight : colors.primary,
              borderWidth: nextFreeCall?.rsvped ? 1.5 : 0,
              borderColor: colors.green,
            },
          ]}
          onPress={onRsvp}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.primaryBtnText,
              { color: nextFreeCall?.rsvped ? colors.green : '#fff' },
            ]}
          >
            {nextFreeCall?.rsvped ? t('situationCta.going') : t('situationCta.rsvp')}
          </Text>
        </TouchableOpacity>
      )}

      {primaryDoor !== 'free_call' && doorRoute && (
        <View style={[styles.doorSection, { borderTopColor: colors.line }]}>
          <Text style={[styles.doorSub, { color: colors.inkSoft }]}>
            {t(`situationCta.${primaryDoor}Sub`)}
          </Text>
          <TouchableOpacity
            style={[styles.doorBtn, { borderColor: colors.primary }]}
            onPress={() => router.push(doorRoute as never)}
            activeOpacity={0.85}
          >
            <Text style={[styles.doorBtnText, { color: colors.primary }]}>
              {t(DOOR_COPY_KEY[primaryDoor])}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  eyebrow: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6 },
  title: { fontSize: 18, fontWeight: '700', marginTop: 6, letterSpacing: -0.3 },
  schedule: { fontSize: 13.5, marginTop: 3, marginBottom: 14 },
  primaryBtn: {
    borderRadius: 99,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  doorSection: { marginTop: 16, paddingTop: 16, borderTopWidth: 1 },
  doorSub: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  doorBtn: {
    borderRadius: 99,
    borderWidth: 1.5,
    paddingVertical: 12,
    alignItems: 'center',
  },
  doorBtnText: { fontSize: 14.5, fontWeight: '700' },
});
