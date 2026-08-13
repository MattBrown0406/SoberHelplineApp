import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { CurriculumPiece } from '../../api/types';

interface Props {
  piece: CurriculumPiece;
  week: number;
  phaseLabel: string;
}

/**
 * This week's teaching piece.
 *
 * Collapsed by default down to title + mechanism: the Today screen is already
 * long, and a family in week 1 should not meet a wall of text. Practice and
 * prompt open on tap. Nothing here is gated and nothing routes away — the
 * piece is the content, not a teaser for it.
 */
export function CurriculumCard({ piece, week, phaseLabel }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <View style={styles.headRow}>
        <View style={[styles.tag, { backgroundColor: piece.tagBackgroundColor }]}>
          <Text style={[styles.tagText, { color: piece.tagTextColor }]}>{piece.tag}</Text>
        </View>
        <Text style={[styles.week, { color: colors.inkSoft }]}>
          {t('curriculum.weekLabel', { week })}
        </Text>
      </View>

      <View style={styles.titleRow}>
        <View style={[styles.iconBox, { backgroundColor: piece.accentColor }]}>
          <Text style={styles.icon}>{piece.icon}</Text>
        </View>
        <View style={styles.titleText}>
          <Text style={[styles.title, { color: colors.ink }]}>{piece.title}</Text>
          <Text style={[styles.phase, { color: colors.inkSoft }]}>{phaseLabel}</Text>
        </View>
      </View>

      <Text style={[styles.mechanism, { color: colors.inkSoft }]}>{piece.mechanism}</Text>

      {open && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.line }]} />
          <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>
            {t('curriculum.practiceLabel')}
          </Text>
          <Text style={[styles.body, { color: colors.ink }]}>{piece.practice}</Text>

          <View style={[styles.divider, { backgroundColor: colors.line }]} />
          <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>
            {t('curriculum.promptLabel')}
          </Text>
          <Text style={[styles.prompt, { color: colors.ink }]}>{piece.prompt}</Text>
        </>
      )}

      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.75}
        style={styles.toggle}
        accessibilityRole="button"
      >
        <Text style={[styles.toggleText, { color: colors.primary }]}>
          {open ? t('curriculum.collapse') : t('curriculum.expand')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  week: { fontSize: 11, fontWeight: '600' },
  titleRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 10 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: { fontSize: 17 },
  titleText: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  phase: { fontSize: 11, marginTop: 2 },
  mechanism: { fontSize: 13, lineHeight: 20 },
  divider: { height: 1, marginTop: 14, marginBottom: 12 },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  body: { fontSize: 13, lineHeight: 20 },
  prompt: { fontSize: 13, lineHeight: 20, fontStyle: 'italic' },
  toggle: { marginTop: 12, alignSelf: 'flex-start' },
  toggleText: { fontSize: 12.5, fontWeight: '700' },
});
