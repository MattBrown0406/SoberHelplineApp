import React from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { CheckIn } from '../../api/types';
import { useTheme } from '../../contexts/ThemeContext';
import { guidedStartCopy } from '../../content/guidedStartCopy';
import { checkInFeedback } from '../../lib/checkInFeedback';
import { GuidedButton } from './GuidedStartPanel';
export function CheckInFeedbackCard({ checkIn }: { checkIn: CheckIn | null }) {
  const { colors } = useTheme(); const { i18n } = useTranslation(); const router = useRouter();
  if (!checkIn) return null;
  const c = guidedStartCopy(i18n.language); const feedback = checkInFeedback(checkIn);
  const [body, action] = c.feedback[feedback.key];
  return <View style={{ borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: 18, padding: 18, marginBottom: 16 }}>
    <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>{c.feedbackTitle}</Text>
    <Text style={{ color: colors.ink, lineHeight: 22, marginTop: 8 }}>{body}</Text>
    {feedback.key === 'safety' && <Text style={{ color: colors.ink, lineHeight: 21, marginTop: 8 }}>{c.disclaimer}</Text>}
    <GuidedButton label={action} onPress={() => router.push(feedback.route)} />
    <Text style={{ color: colors.inkSoft, fontSize: 12, lineHeight: 18, marginTop: 12 }}>{c.feedbackNote}</Text>
  </View>;
}
