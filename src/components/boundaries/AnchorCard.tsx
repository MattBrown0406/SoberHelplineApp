import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

interface Pill {
  id: string;
  label: string;
}

interface Suggestion {
  reason: string;
  wall: string;
}

interface AnchorData {
  eyebrow: string;
  question: string;
  sub: string;
  pills: Pill[];
  suggestions: Record<string, Suggestion>;
}

interface Props {
  anchor: AnchorData;
  onSuggestionSelect: (wallText: string, pillId: string) => void;
}

export function AnchorCard({ anchor, onSuggestionSelect }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('boundaries');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function togglePill(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const visibleSuggestions = anchor.pills.filter((p) => selected.has(p.id));

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>{anchor.eyebrow}</Text>
      <Text style={[styles.question, { color: colors.ink }]}>{anchor.question}</Text>
      <Text style={[styles.sub, { color: colors.inkSoft }]}>{anchor.sub}</Text>

      <View style={styles.pills}>
        {anchor.pills.map((pill) => {
          const active = selected.has(pill.id);
          return (
            <TouchableOpacity
              key={pill.id}
              style={[
                styles.pill,
                {
                  backgroundColor: active ? colors.primary : '#fff',
                  borderColor: active ? colors.primary : colors.line,
                },
              ]}
              onPress={() => togglePill(pill.id)}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: active ? '#fff' : colors.ink },
                ]}
              >
                {pill.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {visibleSuggestions.map((pill) => {
        const sugg = anchor.suggestions[pill.id];
        if (!sugg) return null;
        return (
          <View
            key={pill.id}
            style={[styles.suggBox, { borderColor: colors.line, backgroundColor: colors.cream }]}
          >
            <Text style={[styles.suggReason, { color: colors.inkSoft }]}>
              {sugg.reason}{' '}
              <Text style={[styles.suggLabel, { color: colors.ink }]}>
                {t('suggestion.label')}
              </Text>
            </Text>
            <Text style={[styles.suggWall, { color: colors.ink }]}>
              "{sugg.wall}"
            </Text>
            <TouchableOpacity
              style={[styles.useBtn, { backgroundColor: colors.primary }]}
              onPress={() => onSuggestionSelect(sugg.wall, pill.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.useBtnText}>{t('suggestion.use')}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
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
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  question: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    marginBottom: 5,
  },
  sub: {
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 14,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  pill: {
    borderWidth: 1.5,
    borderRadius: 99,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  suggBox: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 13,
    gap: 6,
  },
  suggReason: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  suggLabel: {
    fontWeight: '600',
  },
  suggWall: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
  },
  useBtn: {
    alignSelf: 'flex-end',
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  useBtnText: {
    color: '#fff',
    fontSize: 12.5,
    fontWeight: '700',
  },
});
