import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { typeLabel, type ProviderType } from '../../api/providers';
import { useTypeColor } from './finderColors';

export function TypeBadge({ type }: { type: ProviderType }) {
  const c = useTypeColor(type);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{typeLabel(type).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 7,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },
});
