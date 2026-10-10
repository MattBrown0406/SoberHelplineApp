import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { openEmergencyLink } from '../../lib/emergencyLinks';
import { text988Url } from '../safety/text988Url';
import type { SafetyKind } from '../../hooks/useRehearsalPartner';

type Resource = 'call911' | 'call988' | 'text988' | 'callHotline' | 'textHotline';

// Every card shows every resource, so a misread disclosure is never missing
// the line she needs; the kind only picks the headline and what comes first.
const ORDER: Record<SafetyKind, Resource[]> = {
  self_harm: ['call988', 'text988', 'call911', 'callHotline', 'textHotline'],
  abuse: ['call911', 'callHotline', 'textHotline', 'call988', 'text988'],
  unknown: ['call911', 'call988', 'text988', 'callHotline', 'textHotline'],
};

/** "Text START to 88788" with the body prefilled (iOS and Android spell the query differently). */
export function hotlineTextUrl(os: string = Platform.OS): string {
  return os === 'ios' ? 'sms:88788&body=START' : 'sms:88788?body=START';
}

function open(resource: Resource, language: string): void {
  switch (resource) {
    case 'call911':
      openEmergencyLink('tel:911');
      return;
    case 'call988':
      openEmergencyLink('tel:988');
      return;
    case 'text988':
      openEmergencyLink(text988Url(language, Platform.OS), '988');
      return;
    case 'callHotline':
      openEmergencyLink('tel:18007997233', '1-800-799-7233');
      return;
    case 'textHotline':
      openEmergencyLink(hotlineTextUrl(), '88788');
  }
}

/**
 * Shown when practice pauses for the member's own safety: 911, 988 (call or
 * text) and the National Domestic Violence Hotline (call or text), one tap
 * each, plus the full crisis screen. When her own latest line triggered the
 * pause, a secondary "I'm safe — keep practicing" follows the resources.
 */
export function SafetyBreakCard({ kind, onKeepPracticing }: { kind: SafetyKind; onKeepPracticing?: () => void }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('rehearsalLive');
  const router = useRouter();
  const heading = kind === 'abuse'
    ? { title: t('chat.abuseTitle'), body: t('chat.abuseBody') }
    : kind === 'self_harm'
      ? { title: t('chat.safetyTitle'), body: t('chat.safetyBody') }
      : { title: t('chat.safetyUnknownTitle'), body: t('chat.safetyUnknownBody') };

  return (
    <View style={[styles.card, { backgroundColor: colors.coralLight }]} accessibilityRole="alert">
      <Text style={[styles.title, { color: colors.coral }]}>{heading.title}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>{heading.body}</Text>
      {ORDER[kind].map((resource, i) => (
        <TouchableOpacity
          key={resource}
          style={[styles.button, { backgroundColor: i === 0 ? colors.coral : colors.primary }]}
          onPress={() => open(resource, i18n.language)}
          accessibilityRole="button"
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>{t(`chat.${resource}`)}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity onPress={() => router.push('/crisis-mode')} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.more, { color: colors.coral }]}>{t('chat.moreSupport')} →</Text>
      </TouchableOpacity>
      {onKeepPracticing && (
        <TouchableOpacity
          style={[styles.keep, { borderColor: colors.inkSoft }]}
          onPress={onKeepPracticing}
          accessibilityRole="button"
          accessibilityHint={t('chat.keepPracticingHint')}
          activeOpacity={0.85}
        >
          <Text style={[styles.keepText, { color: colors.ink }]}>{t('chat.keepPracticing')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 8 },
  title: { fontWeight: '700', fontSize: 14, marginBottom: 4 },
  body: { fontSize: 13, lineHeight: 19, marginBottom: 2 },
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  more: { fontSize: 13, fontWeight: '700', marginTop: 12 },
  keep: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginTop: 14 },
  keepText: { fontSize: 13, fontWeight: '600' },
});
