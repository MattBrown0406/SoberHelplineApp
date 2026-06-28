import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { Button } from '../../src/components/ui/Button';
import { useTheme } from '../../src/contexts/ThemeContext';
import { fetchProviderById, typeLabel, type Provider } from '../../src/api/providers';
import { TypeBadge } from '../../src/components/finder/TypeBadge';
import { AvailabilityPill } from '../../src/components/finder/AvailabilityPill';

function Tags({ items }: { items: string[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.tags}>
      {items.map((t) => (
        <View key={t} style={[styles.tag, { backgroundColor: '#f3f1ea' }]}>
          <Text style={[styles.tagText, { color: colors.inkSoft }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sect, { borderBottomColor: colors.line }]}>
      <Text style={[styles.sectLabel, { color: colors.inkSoft }]}>{label}</Text>
      {children}
    </View>
  );
}

export default function ProviderDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [provider, setProvider] = useState<Provider | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProviderById(id)
      .then(setProvider)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </ScreenContainer>
    );
  }

  if (!provider) {
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        <Text style={{ color: colors.ink, marginTop: 40 }}>Provider not found.</Text>
        <Button label="Back" onPress={() => router.back()} variant="ghost" style={{ marginTop: 16 }} />
      </ScreenContainer>
    );
  }

  const isCenter = provider.type === 'center';
  const ctaLabel = isCenter ? 'Request info & availability' : 'Request a free consult';

  return (
    <ScreenContainer backgroundColor={colors.cream} contentContainerStyle={{ paddingTop: 0 }}>
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.heroBack}>
          <Text style={styles.heroBackIcon}>‹</Text>
        </TouchableOpacity>
        <View style={{ marginBottom: 11 }}>
          <TypeBadge type={provider.type} />
        </View>
        <Text style={styles.heroName}>{provider.name}</Text>
        <Text style={styles.heroLoc}>{provider.location}</Text>
        <AvailabilityPill availability={provider.availability} onDark />
      </View>

      <Section label="ABOUT">
        <Text style={[styles.body, { color: colors.ink }]}>{provider.about}</Text>
      </Section>

      {isCenter ? (
        <>
          {provider.levels && (
            <Section label="LEVELS OF CARE">
              <Tags items={provider.levels} />
            </Section>
          )}
          <Section label="ACCEPTED INSURANCE">
            <View style={styles.tags}>
              {provider.insurance.map((i) => (
                <View key={i} style={[styles.tag, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.tagText, { color: colors.primary }]}>{i}</Text>
                </View>
              ))}
            </View>
          </Section>
          <Section label="TREATMENT APPROACH">
            <Tags items={provider.tags} />
          </Section>
          {provider.conditions && provider.conditions.length > 0 && (
            <Section label="CO-OCCURRING CONDITIONS TREATED">
              <Tags items={provider.conditions} />
            </Section>
          )}
          {provider.populations && provider.populations.length > 0 && (
            <Section label="SPECIALTY POPULATIONS">
              <Tags items={provider.populations} />
            </Section>
          )}
        </>
      ) : (
        <>
          <View style={styles.statline}>
            <Stat value={provider.years ?? '—'} label="years experience" />
            {provider.cases && <Stat value={provider.cases} label="families helped" />}
            <Stat value={(provider.serves ?? '').split(' ')[0] || '—'} label={provider.type === 'interventionist' ? 'service area' : 'availability'} />
          </View>
          {provider.approach && (
            <Section label="APPROACH">
              <Text style={[styles.body, { color: colors.ink }]}>{provider.approach}</Text>
            </Section>
          )}
          <Section label="SPECIALTIES">
            <Tags items={provider.tags} />
          </Section>
          {provider.serves && (
            <Section label="SERVES">
              <Text style={[styles.body, { color: colors.ink }]}>{provider.serves}</Text>
            </Section>
          )}
        </>
      )}

      <Button
        label={ctaLabel}
        onPress={() => router.push({ pathname: '/finder/inquiry', params: { id: provider.id, name: provider.name } })}
        style={{ marginTop: 22 }}
      />
      <Text style={[styles.disc, { color: colors.inkSoft }]}>
        {typeLabel(provider.type)} · A Sober Helpline navigator handles every inquiry — no cost, no pressure.
      </Text>
    </ScreenContainer>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { borderColor: colors.line }]}>
      <Text style={[styles.statValue, { color: colors.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.inkSoft }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: -20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 },
  heroBack: { marginBottom: 10 },
  heroBackIcon: { color: '#fff', fontSize: 26 },
  heroName: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 6 },
  heroLoc: { color: '#c9d6e6', fontSize: 14, marginBottom: 14 },
  sect: { paddingVertical: 18, borderBottomWidth: 1 },
  sectLabel: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.6, marginBottom: 10 },
  body: { fontSize: 14.5, lineHeight: 23 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8 },
  tagText: { fontSize: 12 },
  statline: { flexDirection: 'row', gap: 10, marginTop: 18 },
  stat: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11.5, marginTop: 2, textAlign: 'center' },
  disc: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 14 },
});
