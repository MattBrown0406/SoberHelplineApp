import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { moveCopy } from '../../lib/invitationCopy';
import { moveHint, type InvitationMove } from '../../lib/invitationMoves';
import type { LovedOneProfile } from '../../lib/lovedOneProfile';
import { EngineCard, Kicker } from './ui';

/**
 * Today's two CRAFT moves with one-tap "done". The plan is shared across the
 * family space; done-logging is per member. `compact` hides the how-to and
 * example (Today card).
 */
export function DailyMovesCard({
  moves,
  movesDone,
  onToggle,
  busyMove,
  error,
  familyScope,
  ownProfile,
  localDate,
  compact = false,
}: {
  moves: readonly InvitationMove[];
  movesDone: readonly string[];
  onToggle: (moveId: string) => void;
  busyMove: string | null;
  error: boolean;
  familyScope: boolean;
  ownProfile: LovedOneProfile | null;
  localDate: string;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const allDone = moves.length > 0 && moves.every((move) => movesDone.includes(move.id));

  const content = (
    <>
      {!compact && <Kicker>{t('moves.kicker')}</Kicker>}
      {moves.map((move, index) => {
        const copy = moveCopy(move);
        const done = movesDone.includes(move.id);
        const busy = busyMove === move.id;
        const title = t(copy.title);
        const hint = compact ? null : moveHint(move, ownProfile, localDate);
        return (
          <View
            key={move.id}
            style={[
              styles.move,
              index > 0 && { borderTopWidth: 1, borderTopColor: colors.line },
            ]}
          >
            <Text style={[styles.category, { color: colors.inkSoft }]}>{t(copy.category).toUpperCase()}</Text>
            <Text style={[styles.title, { color: colors.ink }, done && styles.titleDone]}>{title}</Text>
            {!compact && <Text style={[styles.body, { color: colors.ink }]}>{t(copy.body)}</Text>}
            {!compact && (
              <View style={[styles.example, { backgroundColor: colors.cream, borderColor: colors.line }]}>
                <Text style={[styles.exampleLabel, { color: colors.inkSoft }]}>{t('moves.exampleLabel').toUpperCase()}</Text>
                <Text style={[styles.exampleText, { color: colors.ink }]}>{t(copy.example)}</Text>
              </View>
            )}
            {hint && (
              <Text style={[styles.hint, { color: colors.primary }]}>{t(hint.key, { item: hint.item })}</Text>
            )}
            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityLabel={done ? t('moves.undoA11y', { title }) : t('moves.doneA11y', { title })}
              accessibilityState={{ checked: done, busy, disabled: !!busyMove }}
              disabled={!!busyMove}
              onPress={() => onToggle(move.id)}
              style={[
                styles.doneButton,
                {
                  backgroundColor: done ? colors.green : colors.white,
                  borderColor: done ? colors.green : colors.primary,
                },
              ]}
            >
              {busy
                ? <ActivityIndicator color={done ? '#fff' : colors.primary} />
                : (
                  <Text style={[styles.doneText, { color: done ? '#fff' : colors.primary }]}>
                    {done ? t('moves.done') : t('moves.markDone')}
                  </Text>
                )}
            </TouchableOpacity>
          </View>
        );
      })}
      {allDone && (
        <Text accessibilityLiveRegion="polite" style={[styles.allDone, { color: colors.green }]}>{t('moves.allDone')}</Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('moves.error')}</Text>
      )}
      {familyScope && !compact && (
        <Text style={[styles.family, { color: colors.inkSoft }]}>{t('moves.familyNote')}</Text>
      )}
    </>
  );

  return compact ? <View>{content}</View> : <EngineCard>{content}</EngineCard>;
}

const styles = StyleSheet.create({
  move: { paddingVertical: 12 },
  category: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1 },
  title: { fontSize: 16.5, lineHeight: 22, fontWeight: '800', marginTop: 3 },
  titleDone: { opacity: 0.75 },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  example: { borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 10 },
  exampleLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1 },
  exampleText: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 4 },
  hint: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 8 },
  doneButton: {
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
    minWidth: 140,
  },
  doneText: { fontSize: 14, fontWeight: '800' },
  allDone: { fontSize: 13.5, lineHeight: 19, fontWeight: '800', marginTop: 6 },
  error: { fontSize: 12.5, fontWeight: '700', marginTop: 6 },
  family: { fontSize: 12, lineHeight: 17, marginTop: 8, fontStyle: 'italic' },
});
