import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { buttonShape } from '../ui/Button';
import { PRIMARY_ON_CALL } from '../../content/onCall';
import type { StaffMember } from '../../api/types';
import { supportCard, supportEyebrow } from './cardStyle';

function StaffChip({ staff, label }: { staff: StaffMember; label: string }) {
  const { colors } = useTheme();
  const initials = `${staff.firstName[0]}${staff.lastName[0]}`;
  return (
    <View style={styles.staffChip}>
      <View style={[styles.staffAvatar, { backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.staffInitials, { color: colors.primary }]}>{initials}</Text>
      </View>
      <View style={styles.staffInfo}>
        <Text style={[styles.staffName, { color: colors.ink }]}>
          {staff.firstName} {staff.lastName}
          {staff.credentialDisplay ? `, ${staff.credentialDisplay}` : ''}
        </Text>
        <Text style={[styles.staffRole, { color: colors.inkSoft }]}>
          {staff.roleLabel}
          {staff.isOnCall ? ` · ${label}` : ''}
        </Text>
      </View>
    </View>
  );
}

/** An attached family's team (their provider's on-call coach) and a way to message them. */
export function TeamCard() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const router = useRouter();
  const roster = { primaryOnCall: PRIMARY_ON_CALL, available: [] as StaffMember[] };
  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('team.eyebrow')}
      </Text>
      <StaffChip staff={roster.primaryOnCall} label={t('team.onCall')} />
      {roster.available.map((s) => (
        <StaffChip key={s.id} staff={s} label="" />
      ))}
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.outlineBtn, { borderColor: colors.primary }]}
        activeOpacity={0.8}
        onPress={() => router.push('/chat')}
      >
        <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
          {t('team.messageButton')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: supportCard,
  eyebrow: supportEyebrow,
  staffChip: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  staffAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  staffInitials: { fontWeight: '700', fontSize: 14 },
  staffInfo: { flex: 1 },
  staffName: { fontSize: 14, fontWeight: '600' },
  staffRole: { fontSize: 12, marginTop: 1 },
  outlineBtn: {
    ...buttonShape,
    borderWidth: 1.5,
    paddingVertical: 10,
    marginTop: 8,
  },
  outlineBtnText: { fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
});
