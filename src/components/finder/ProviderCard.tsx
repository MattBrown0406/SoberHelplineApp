import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { Provider } from '../../api/providers';
import { TypeBadge } from './TypeBadge';
import { AvailabilityPill } from './AvailabilityPill';

function Tag({ text, insurance = false }: { text: string; insurance?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: insurance ? colors.primaryLight : '#f3f1ea' },
      ]}
    >
      <Text style={[styles.tagText, { color: insurance ? colors.primary : colors.inkSoft }]}>
        {text}
      </Text>
    </View>
  );
}

export function ProviderCard({
  provider,
  onPress,
}: {
  provider: Provider;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.card, { borderColor: colors.line }]}>
      <View style={styles.top}>
        <TypeBadge type={provider.type} />
        <View style={{ marginLeft: 'auto' }}>
          <AvailabilityPill availability={provider.availability} />
        </View>
      </View>

      <Text style={[styles.name, { color: colors.ink }]}>{provider.name}</Text>
      <Text style={[styles.loc, { color: colors.inkSoft }]}>
        {provider.location}
        {provider.distance ? `  ·  ${provider.distance}` : ''}
      </Text>

      <View style={styles.tags}>
        {provider.insurance.slice(0, 3).map((i) => (
          <Tag key={i} text={i} insurance />
        ))}
        {provider.tags.slice(0, 3).map((tg) => (
          <Tag key={tg} text={tg} />
        ))}
      </View>

      <View style={[styles.foot, { borderTopColor: colors.line }]}>
        <Text style={[styles.price, { color: colors.inkSoft }]}>{provider.price}</Text>
        <View style={[styles.go, { backgroundColor: colors.primary }]}>
          <Text style={styles.goText}>View ›</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    padding: 15,
    marginBottom: 13,
  },
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  name: { fontSize: 17, fontWeight: '700', marginBottom: 3 },
  loc: { fontSize: 13, marginBottom: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 11 },
  tag: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7 },
  tagText: { fontSize: 11.5 },
  foot: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingTop: 11 },
  price: { fontSize: 12.5 },
  go: { marginLeft: 'auto', paddingVertical: 9, paddingHorizontal: 15, borderRadius: 10 },
  goText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
});
