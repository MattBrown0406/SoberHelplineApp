import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { Button } from '../../src/components/ui/Button';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useProviderSearch } from '../../src/hooks/useProviderSearch';
import { LOC_OPTIONS, type ProviderType } from '../../src/api/providers';
import { ProviderCard } from '../../src/components/finder/ProviderCard';
import { FilterChip } from '../../src/components/finder/FilterChip';

type Step = 'intro' | 'loc' | 'details' | 'results';

const INSURANCE = ['Aetna', 'BCBS', 'Cigna', 'UnitedHealthcare', 'Humana', 'Tricare', 'Medicaid', 'Medicare', 'Self-pay'];
const AGES = ['Adult', 'Young adult (18–25)', 'Adolescent'];
const GENDERS = ['Co-ed', 'Male', 'Female', 'Non-binary affirming'];
const CONDITIONS = ['Depression', 'Anxiety', 'Trauma / PTSD', 'Bipolar', 'BPD', 'ADHD', 'Eating disorders'];
const MODALITIES = ['CBT', 'DBT', 'EMDR', 'MAT-friendly', '12-step', 'Non-12-step', 'Holistic', 'Faith-based', 'Equine', 'Somatic'];
const POPULATIONS = ['LGBTQ+ affirming', 'Veterans', 'Professionals', 'First responders', 'Pregnant women'];
const STATES = ['Any state', 'California', 'Florida', 'Texas', 'New York', 'Arizona', 'Colorado'];

const CATS: { type: ProviderType; emoji: string; title: string; sub: string }[] = [
  { type: 'center', emoji: '🏥', title: 'Treatment centers', sub: 'Detox, residential, PHP, IOP, outpatient, sober living' },
  { type: 'interventionist', emoji: '🤝', title: 'Interventionists', sub: 'Help getting a loved one to accept treatment' },
  { type: 'coach', emoji: '🧭', title: 'Sober coaches & companions', sub: 'One-on-one support through early recovery' },
];

const LOC_HEAD: Record<ProviderType, { title: string; lede: string }> = {
  center: { title: 'What level of care?', lede: "Pick what fits best — you can change this later. Not sure? Choose “Help me decide.”" },
  interventionist: { title: 'How soon do you need help?', lede: 'This helps us match you with an interventionist who can mobilize on your timeline.' },
  coach: { title: 'What kind of support?', lede: 'Tell us where your loved one is right now so we match the right coach.' },
};

export default function FinderScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const search = useProviderSearch();
  const { filters, setPath, setField, toggleField, results, alsoRecommended, loading } = search;

  const [step, setStep] = useState<Step>('intro');

  function goBack() {
    if (step === 'intro') return router.back();
    if (step === 'loc') return setStep('intro');
    if (step === 'details') return setStep('loc');
    return setStep('details');
  }
  function chooseCategory(type: ProviderType) {
    setPath(type);
    setField('loc', null);
    setStep('loc');
  }

  const stepIndex = step === 'loc' ? 1 : step === 'details' ? 2 : step === 'results' ? 3 : 0;

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <View style={styles.bar}>
        <TouchableOpacity onPress={goBack} style={[styles.back, { borderColor: colors.line }]}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.barTitle, { color: colors.primary }]}>Treatment Finder</Text>
      </View>

      {step !== 'intro' && (
        <View style={styles.steps}>
          {[1, 2, 3].map((s) => (
            <View
              key={s}
              style={[styles.stepBar, { backgroundColor: s <= stepIndex ? colors.primary : colors.sand }]}
            />
          ))}
        </View>
      )}

      {step === 'intro' && (
        <>
          <Text style={[styles.h1, { color: colors.primary }]}>Let's find the right help for someone you love.</Text>
          <Text style={[styles.lede, { color: colors.inkSoft }]}>
            Answer a few quick questions and we'll match you with vetted treatment centers, interventionists, and sober coaches — with real availability.
          </Text>
          <Text style={[styles.h2, { color: colors.inkSoft }]}>WHAT ARE YOU LOOKING FOR?</Text>
          {CATS.map((c) => (
            <TouchableOpacity
              key={c.type}
              activeOpacity={0.85}
              onPress={() => chooseCategory(c.type)}
              style={[styles.cat, { borderColor: colors.line }]}
            >
              <Text style={styles.catEmoji}>{c.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.catTitle, { color: colors.ink }]}>{c.title}</Text>
                <Text style={[styles.catSub, { color: colors.inkSoft }]}>{c.sub}</Text>
              </View>
              <Text style={[styles.arr, { color: colors.primary }]}>›</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {step === 'loc' && (
        <>
          <Text style={[styles.h1, { color: colors.primary }]}>{LOC_HEAD[filters.path].title}</Text>
          <Text style={[styles.lede, { color: colors.inkSoft }]}>{LOC_HEAD[filters.path].lede}</Text>
          {LOC_OPTIONS[filters.path].map((o) => {
            const sel = filters.loc === o.key;
            return (
              <TouchableOpacity
                key={o.key}
                activeOpacity={0.85}
                onPress={() => setField('loc', o.key)}
                style={[styles.opt, { borderColor: sel ? colors.primary : colors.line, backgroundColor: sel ? '#f3f7fc' : '#fff' }]}
              >
                <View style={[styles.tick, { borderColor: sel ? colors.primary : colors.sand, backgroundColor: sel ? colors.primary : 'transparent' }]}>
                  {sel && <Text style={styles.tickMark}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optTitle, { color: colors.ink }]}>{o.title}</Text>
                  <Text style={[styles.optSub, { color: colors.inkSoft }]}>{o.subtitle}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <Button label="Continue" onPress={() => setStep('details')} style={{ marginTop: 8 }} />
        </>
      )}

      {step === 'details' && (
        <>
          <Text style={[styles.h1, { color: colors.primary }]}>A few details</Text>
          <Text style={[styles.lede, { color: colors.inkSoft }]}>
            This helps us show only providers that actually fit. Everything is optional.
          </Text>

          <Text style={[styles.h2, { color: colors.inkSoft }]}>LOCATION</Text>
          <View style={styles.chips}>
            {STATES.map((s) => (
              <FilterChip key={s} label={s} selected={filters.state === s} onPress={() => setField('state', s)} />
            ))}
          </View>
          <TextInput
            value={filters.zip}
            onChangeText={(v) => setField('zip', v)}
            placeholder="ZIP code"
            keyboardType="number-pad"
            style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
            placeholderTextColor={colors.inkSoft}
          />

          <Section label="INSURANCE">
            {INSURANCE.map((i) => (
              <FilterChip key={i} label={i} selected={filters.insurance.includes(i)} onPress={() => toggleField('insurance', i)} />
            ))}
          </Section>

          <Section label="WHO IS IT FOR?">
            {AGES.map((a) => (
              <FilterChip key={a} label={a} selected={filters.age === a} onPress={() => setField('age', a)} />
            ))}
          </Section>
          <View style={[styles.chips, { marginTop: 8 }]}>
            {GENDERS.map((g) => (
              <FilterChip key={g} label={g} selected={filters.gender === g} onPress={() => setField('gender', g)} />
            ))}
          </View>

          <Section label="MENTAL HEALTH / DUAL DIAGNOSIS">
            {CONDITIONS.map((c) => (
              <FilterChip key={c} label={c} selected={filters.conditions.includes(c)} onPress={() => toggleField('conditions', c)} />
            ))}
          </Section>

          <Section label="APPROACH & MODALITIES">
            {MODALITIES.map((m) => (
              <FilterChip key={m} label={m} selected={filters.modalities.includes(m)} onPress={() => toggleField('modalities', m)} />
            ))}
          </Section>

          <Section label="SPECIALTY POPULATIONS">
            {POPULATIONS.map((p) => (
              <FilterChip key={p} label={p} selected={filters.populations.includes(p)} onPress={() => toggleField('populations', p)} />
            ))}
          </Section>

          <Button label="Show matches" onPress={() => setStep('results')} style={{ marginTop: 18 }} />
        </>
      )}

      {step === 'results' && (
        <>
          <View style={styles.resHead}>
            <Text style={[styles.resN, { color: colors.primary }]}>
              {results.length} {filters.path === 'center' ? 'centers' : filters.path === 'interventionist' ? 'interventionists' : 'coaches'} near {filters.state === 'Any state' ? filters.zip : filters.state}
            </Text>
            <TouchableOpacity onPress={() => setStep('details')}>
              <Text style={[styles.edit, { color: colors.primary }]}>Edit</Text>
            </TouchableOpacity>
          </View>
          {filters.insurance.length + filters.conditions.length + filters.modalities.length > 0 && (
            <Text style={[styles.sum, { color: colors.inkSoft }]}>
              Filters: {[...filters.insurance, ...filters.conditions, ...filters.modalities].join(' · ')}
            </Text>
          )}

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
          ) : results.length === 0 ? (
            <Text style={[styles.sum, { color: colors.inkSoft, marginTop: 16 }]}>
              No providers found. Try broadening your filters or choosing a different state.
            </Text>
          ) : (
            results.map((p) => (
              <ProviderCard key={p.id} provider={p} onPress={() => router.push(`/finder/${p.id}`)} />
            ))
          )}

          {alsoRecommended.length > 0 && (
            <>
              <Text style={[styles.h2, { color: colors.inkSoft, marginTop: 22 }]}>ALSO RECOMMENDED FOR YOUR SITUATION</Text>
              {alsoRecommended.map((p) => (
                <ProviderCard key={p.id} provider={p} onPress={() => router.push(`/finder/${p.id}`)} />
              ))}
            </>
          )}
        </>
      )}
    </ScreenContainer>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <>
      <Text style={[styles.h2, { color: colors.inkSoft }]}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  back: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, marginTop: -2 },
  barTitle: { fontSize: 16, fontWeight: '700' },
  steps: { flexDirection: 'row', gap: 6, marginTop: 12, marginBottom: 4 },
  stepBar: { flex: 1, height: 4, borderRadius: 3 },
  h1: { fontSize: 25, fontWeight: '700', lineHeight: 30, marginTop: 14, marginBottom: 8 },
  lede: { fontSize: 15, lineHeight: 22, marginBottom: 18 },
  h2: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.6, marginTop: 20, marginBottom: 10 },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  catEmoji: { fontSize: 26 },
  catTitle: { fontSize: 16, fontWeight: '600', marginBottom: 3 },
  catSub: { fontSize: 13, lineHeight: 18 },
  arr: { fontSize: 22 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 13, padding: 14, marginBottom: 10 },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tickMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  optTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  optSub: { fontSize: 12.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 13, fontSize: 15, backgroundColor: '#fff', marginTop: 10 },
  resHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  resN: { fontSize: 15, fontWeight: '700', flex: 1 },
  edit: { fontSize: 13, fontWeight: '600' },
  sum: { fontSize: 12.5, marginBottom: 16, lineHeight: 18 },
});
