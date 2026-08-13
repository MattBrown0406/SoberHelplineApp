import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { HoldLogEntry, HoldResult } from '../../hooks/useHoldLog';

interface Props {
  own: HoldLogEntry | null;
  shared: HoldLogEntry[];
  saving: boolean;
  canShare: boolean;
  nameFor: (accountId: string) => string;
  onSave: (result: HoldResult, shareWithFamily: boolean) => void;
}

const RESULTS: HoldResult[] = ['held', 'mostly', 'slipped'];

export function HoldLogCard({ own, shared, saving, canShare, nameFor, onSave }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('alignment');
  const share = own?.sharedWithFamily === true;

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>{t('holdLog.eyebrow')}</Text>
      <Text style={[styles.title, { color: colors.ink }]}>{t('holdLog.title')}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t('holdLog.body')}</Text>

      <View style={styles.row}>
        {RESULTS.map((result) => {
          const active = own?.result === result;
          return (
            <TouchableOpacity
              key={result}
              style={[
                styles.choice,
                {
                  borderColor: active ? colors.primary : colors.line,
                  backgroundColor: active ? colors.primaryLight : '#fff',
                },
              ]}
              disabled={saving}
              onPress={() => onSave(result, own?.sharedWithFamily ?? false)}
            >
              <Text style={[styles.choiceText, { color: active ? colors.primary : colors.ink }]}>
                {t(`holdLog.${result}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {own ? (
        <Text style={[styles.note, { color: colors.inkSoft }]}>
          {own.sharedWithFamily ? t('holdLog.shared') : t('weeklyNote')}
        </Text>
      ) : (
        <Text style={[styles.note, { color: colors.inkSoft }]}>{t('weeklyNote')}</Text>
      )}

      {canShare && own && !own.sharedWithFamily ? (
        <TouchableOpacity
          style={[styles.shareBtn, { borderColor: colors.primary }]}
          disabled={saving}
          onPress={() => onSave(own.result, true)}
        >
          {saving ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={[styles.shareText, { color: colors.primary }]}>{t('holdLog.share')}</Text>
          )}
        </TouchableOpacity>
      ) : null}

      {canShare && own && share ? (
        <TouchableOpacity
          style={[styles.shareBtn, { borderColor: colors.line }]}
          disabled={saving}
          onPress={() => onSave(own.result, false)}
        >
          <Text style={[styles.shareText, { color: colors.inkSoft }]}>{t('holdLog.unshare')}</Text>
        </TouchableOpacity>
      ) : null}

      {shared.length > 0 ? (
        <View style={[styles.sharedBox, { borderTopColor: colors.line }]}>
          <Text style={[styles.sharedEyebrow, { color: colors.inkSoft }]}>{t('holdLog.familyThisWeek')}</Text>
          {shared.map((entry) => (
            <Text key={entry.id} style={[styles.sharedLine, { color: colors.ink }]}>
              {t('holdLog.familyLine', {
                name: nameFor(entry.accountId),
                result: t(`holdLog.${entry.result}`).toLowerCase(),
              })}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  body: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  choice: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  choiceText: { fontSize: 13, fontWeight: '700' },
  note: { fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  shareBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center', marginTop: 10 },
  shareText: { fontSize: 13, fontWeight: '700' },
  sharedBox: { borderTopWidth: 1, marginTop: 14, paddingTop: 12, gap: 6 },
  sharedEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  sharedLine: { fontSize: 13, lineHeight: 19 },
});
