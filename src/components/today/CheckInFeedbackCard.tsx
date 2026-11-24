import React from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { CheckIn } from '../../api/types';
import { useTheme } from '../../contexts/ThemeContext';
import { guidedStartCopy } from '../../content/guidedStartCopy';
import { useAccount } from '../../contexts/AccountContext';
import { checkInFeedback } from '../../lib/checkInFeedback';
import { toDateStr } from '../../storage/checkIn';
import { CheckInFellowshipStep } from './CheckInFellowshipStep';
import { GuidedButton } from './GuidedStartPanel';
export function CheckInFeedbackCard({ checkIn }: { checkIn: CheckIn | null }) {
  const { colors } = useTheme(); const { i18n } = useTranslation(); const router = useRouter(); const { user } = useAccount();
  if (!checkIn) return null;
  const c = guidedStartCopy(i18n.language); const feedback = checkInFeedback(checkIn);
  // The check-in's own day in her time zone: the meeting suggestion belongs to it.
  const checkInDay = toDateStr(new Date(checkIn.completedAt), user?.timezone);
  const [body, action] = c.feedback[feedback.key];
  return <View style={{ borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: 18, padding: 18, marginBottom: 16 }}>
    <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>{c.feedbackTitle}</Text>
    <Text style={{ color: colors.ink, lineHeight: 22, marginTop: 8 }}>{body}</Text>
    {feedback.key === 'safety' && <Text style={{ color: colors.ink, lineHeight: 21, marginTop: 8 }}>{c.disclaimer}</Text>}
    <GuidedButton label={action} onPress={() => router.push(feedback.route)} />
    <Text style={{ color: colors.inkSoft, fontSize: 12, lineHeight: 18, marginTop: 12 }}>{c.feedbackNote}</Text>
    {/* After a hard check-in (never a safety answer): a meeting for families, then Matt or booking. */}
    {feedback.key !== 'safety' && <CheckInFellowshipStep key={`${user?.id ?? 'none'}:${checkInDay}`} checkIn={checkIn} checkInDay={checkInDay} />}
  </View>;
}
