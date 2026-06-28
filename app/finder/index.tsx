import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, ScrollView, SafeAreaView,
} from 'react-native';
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
const BUDGETS = ['Any budget', 'Under $5,000/mo', 'Under $10,000/mo', 'Under $20,000/mo', 'Under $30,000/mo'];
const STATES = [
  'Any state',
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming',
];

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
  const [stateOpen, setStateOpen] = useState(false);
  const [budget, setBudget] = useState('Any budget');

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
  const isCenter = filters.path === 'center';
  const selectedState = filters.state && filters.state !== 'Any state' ? filters.state : null;

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
            {isCenter
              ? 'This helps us show only centers that actually fit. Everything is optional.'
              : 'Tell us where you are and what matters most. Everything is optional.'}
          </Text>

          {/* Location — shown for all paths */}
          <Text style={[styles.h2, { color: colors.inkSoft }]}>LOCATION</Text>
          <TouchableOpacity
            onPress={() => setStateOpen(true)}
            style={[styles.dropdown, { borderColor: colors.line }]}
          >
            <Text style={[styles.dropdownText, { color: selectedState ? colors.ink : colors.inkSoft }]}>
              {selectedState ?? 'Select state'}
            </Text>
            <Text style={[styles.dropdownArrow, { color: colors.inkSoft }]}>▾</Text>
          </TouchableOpacity>
          <TextInput
            value={filters.zip}
            onChangeText={(v) => setField('zip', v)}
            placeholder="ZIP code (optional)"
            keyboardType="number-pad"
            style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
            placeholderTextColor={colors.inkSoft}
          />

          {/* Center-only filters */}
          {isCenter && (
            <>
              <Section label="BUDGET">
                {BUDGETS.map((b) => (
                  <FilterChip key={b} label={b} selected={budget === b} onPress={() => setBudget(b)} />
                ))}
              </Section>

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
            </>
          )}

          <Button label="Show matches" onPress={() => setStep('results')} style={{ marginTop: 18 }} />
        </>
      )}

      {step === 'results' && (
        <>
          <View style={styles.resHead}>
            <Text style={[styles.resN, { color: colors.primary }]}>
              {results.length} {filters.path === 'center' ? 'centers' : filters.path === 'interventionist' ? 'interventionists' : 'coaches'}
              {selectedState ? ` in ${selectedState}` : ''}
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
              No providers found. Try selecting "Any state" or removing filters.
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

      {/* State picker modal */}
      <Modal visible={stateOpen} transparent animationType="slide" onRequestClose={() => setStateOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setStateOpen(false)} />
        <SafeAreaView style={[styles.sheet, { backgroundColor: colors.white }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: colors.line }]}>
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>Select state</Text>
            <TouchableOpacity onPress={() => setStateOpen(false)}>
              <Text style={[styles.sheetDone, { color: colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {STATES.map((s) => {
              const sel = (filters.state || 'Any state') === s;
              return (
                <TouchableOpacity
                  key={s}
                  onPress={() => { setField('state', s); setStateOpen(false); }}
                  style={[styles.sheetRow, { borderBottomColor: colors.line, backgroundColor: sel ? colors.primaryLight : 'transparent' }]}
                >
                  <Text style={[styles.sheetRowText, { color: sel ? colors.primary : colors.ink, fontWeight: sel ? '600' : '400' }]}>{s}</Text>
                  {sel && <Text style={[styles.sheetCheck, { color: colors.primary }]}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
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
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 11, paddingVertical: 13, paddingHorizontal: 13, backgroundColor: '#fff' },
  dropdownText: { fontSize: 15 },
  dropdownArrow: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 13, fontSize: 15, backgroundColor: '#fff', marginTop: 10 },
  resHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  resN: { fontSize: 15, fontWeight: '700', flex: 1 },
  edit: { fontSize: 13, fontWeight: '600' },
  sum: { fontSize: 12.5, marginBottom: 16, lineHeight: 18 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  sheetTitle: { fontSize: 16, fontWeight: '600' },
  sheetDone: { fontSize: 15, fontWeight: '600' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetRowText: { fontSize: 16 },
  sheetCheck: { fontSize: 16 },
});
