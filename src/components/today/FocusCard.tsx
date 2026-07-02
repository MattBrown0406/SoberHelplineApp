import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { DailyFocusItem } from '../../api/types';

interface Props {
  items: DailyFocusItem[];
}

export function FocusCard({ items }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('focus.eyebrow')}
      </Text>
      {items.map((item, idx) => {
        const rowStyle = [
          styles.item,
          idx < items.length - 1 && {
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
          },
        ];
        const inner = (
          <>
            <View style={[styles.iconBox, { backgroundColor: item.accentColor }]}>
              <Text style={styles.icon}>{item.icon}</Text>
            </View>
            <View style={styles.text}>
              <Text style={[styles.title, { color: colors.ink }]}>{item.title}</Text>
              <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
                {item.subtitle}
              </Text>
            </View>
            {item.route ? (
              <Text style={[styles.chevron, { color: colors.inkSoft }]}>›</Text>
            ) : null}
          </>
        );
        return item.route ? (
          <TouchableOpacity
            key={item.id}
            style={rowStyle}
            activeOpacity={0.75}
            onPress={() => router.push(item.route as never)}
          >
            {inner}
          </TouchableOpacity>
        ) : (
          <View key={item.id} style={rowStyle}>
            {inner}
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
    padding: 16,
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
    marginBottom: 4,
  },
  item: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 11,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: { fontSize: 17 },
  text: { flex: 1 },
  title: {
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  chevron: { fontSize: 20, marginLeft: 2 },
});
