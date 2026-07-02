import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, ScrollView, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { Button } from '../../src/components/ui/Button';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useProviderSearch } from '../../src/hooks/useProviderSearch';
import { LOC_OPTIONS, type ProviderType } from '../../src/api/providers';
import { ProviderCard } from '../../src/components/finder/ProviderCard';
import { FilterChip } from '../../src/components/finder/FilterChip';

type Step = 'intro' | 'loc' | 'details' | 'results';

// Canonical values sent to the provider database — never localized.
// (Insurance names match insurances_accepted; state names match the state column.)
const INSURANCE = ['Aetna', 'BCBS', 'Cigna', 'UnitedHealthcare', 'Humana', 'Tricare', 'Medicaid', 'Medicare', 'Self-pay'];
const ANY_STATE = 'Any state';
const STATES = [
  ANY_STATE,
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming',
];

const CAT_EMOJI: Record<ProviderType, string> = {
  center: '🏥',
  interventionist: '🤝',
  coach: '🧭',
};
const CAT_ORDER: ProviderType[] = ['center', 'interventionist', 'coach'];

export default function FinderScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('finder');
  const router = useRouter();
  const search = useProviderSearch();
  const { filters, setPath, setField, toggleField, results, alsoRecommended, loading } = search;

  const [step, setStep] = useState<Step>('intro');
  const [stateOpen, setStateOpen] = useState(false);
  const [budgetIdx, setBudgetIdx] = useState(0);

  const AGES = t('details.ages', { returnObjects: true }) as string[];
  const GENDERS = t('details.genders', { returnObjects: true }) as string[];
  const CONDITIONS = t('details.conditionsList', { returnObjects: true }) as string[];
  const MODALITIES = t('details.modalities', { returnObjects: true }) as string[];
  const POPULATIONS = t('details.populationsList', { returnObjects: true }) as string[];
  const BUDGETS = t('details.budgets', { returnObjects: true }) as string[];

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
  const selectedState = filters.state && filters.state !== ANY_STATE ? filters.state : null;
  const displayState = (s: string) => (s === ANY_STATE ? t('details.anyState') : s);
  const displayInsurance = (i: string) => (i === 'Self-pay' ? t('details.selfPay') : i);

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <View style={styles.bar}>
        <TouchableOpacity onPress={goBack} style={[styles.back, { borderColor: colors.line }]}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.barTitle, { color: colors.primary }]}>{t('title')}</Text>
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
          <Text style={[styles.h1, { color: colors.primary }]}>{t('intro.h1')}</Text>
          <Text style={[styles.lede, { color: colors.inkSoft }]}>{t('intro.lede')}</Text>
          <Text style={[styles.h2, { color: colors.inkSoft }]}>{t('intro.whatEyebrow').toUpperCase()}</Text>
          {CAT_ORDER.map((type) => (
            <TouchableOpacity
              key={type}
              activeOpacity={0.85}
              onPress={() => chooseCategory(type)}
              style={[styles.cat, { borderColor: colors.line }]}
            >
              <Text style={styles.catEmoji}>{CAT_EMOJI[type]}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.catTitle, { color: colors.ink }]}>{t(`cats.${type}.title`)}</Text>
                <Text style={[styles.catSub, { color: colors.inkSoft }]}>{t(`cats.${type}.sub`)}</Text>
              </View>
              <Text style={[styles.arr, { color: colors.primary }]}>›</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {step === 'loc' && (
        <>
          <Text style={[styles.h1, { color: colors.primary }]}>{t(`locHead.${filters.path}.title`)}</Text>
          <Text style={[styles.lede, { color: colors.inkSoft }]}>{t(`locHead.${filters.path}.lede`)}</Text>
          {LOC_OPTIONS[filters.path].map((key) => {
            const sel = filters.loc === key;
            return (
              <TouchableOpacity
                key={key}
                activeOpacity={0.85}
                onPress={() => setField('loc', key)}
                style={[styles.opt, { borderColor: sel ? colors.primary : colors.line, backgroundColor: sel ? '#f3f7fc' : '#fff' }]}
              >
                <View style={[styles.tick, { borderColor: sel ? colors.primary : colors.sand, backgroundColor: sel ? colors.primary : 'transparent' }]}>
                  {sel && <Text style={styles.tickMark}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optTitle, { color: colors.ink }]}>{t(`loc.${filters.path}.${key}.title`)}</Text>
                  <Text style={[styles.optSub, { color: colors.inkSoft }]}>{t(`loc.${filters.path}.${key}.sub`)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <Button label={t('details.continue')} onPress={() => setStep('details')} style={{ marginTop: 8 }} />
        </>
      )}

      {step === 'details' && (
        <>
          <Text style={[styles.h1, { color: colors.primary }]}>{t('details.h1')}</Text>
          <Text style={[styles.lede, { color: colors.inkSoft }]}>
            {isCenter ? t('details.ledeCenter') : t('details.ledeOther')}
          </Text>

          {/* Location — shown for all paths */}
          <Text style={[styles.h2, { color: colors.inkSoft }]}>{t('details.location').toUpperCase()}</Text>
          <TouchableOpacity
            onPress={() => setStateOpen(true)}
            style={[styles.dropdown, { borderColor: colors.line }]}
          >
            <Text style={[styles.dropdownText, { color: selectedState ? colors.ink : colors.inkSoft }]}>
              {selectedState ?? t('details.selectState')}
            </Text>
            <Text style={[styles.dropdownArrow, { color: colors.inkSoft }]}>▾</Text>
          </TouchableOpacity>
          <TextInput
            value={filters.zip}
            onChangeText={(v) => setField('zip', v)}
            placeholder={t('details.zipPlaceholder')}
            keyboardType="number-pad"
            style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
            placeholderTextColor={colors.inkSoft}
          />

          {/* Center-only filters */}
          {isCenter && (
            <>
              <Section label={t('details.insurance').toUpperCase()}>
                {INSURANCE.map((i) => (
                  <FilterChip key={i} label={displayInsurance(i)} selected={filters.insurance.includes(i)} onPress={() => toggleField('insurance', i)} />
                ))}
              </Section>

              {/* Budget only matters for cash/self-pay families */}
              {filters.insurance.includes('Self-pay') && (
                <Section label={t('details.budget').toUpperCase()}>
                  {BUDGETS.map((b, idx) => (
                    <FilterChip key={b} label={b} selected={budgetIdx === idx} onPress={() => setBudgetIdx(idx)} />
                  ))}
                </Section>
              )}

              <Section label={t('details.whoFor').toUpperCase()}>
                {AGES.map((a) => (
                  <FilterChip key={a} label={a} selected={filters.age === a} onPress={() => setField('age', a)} />
                ))}
              </Section>
              <View style={[styles.chips, { marginTop: 8 }]}>
                {GENDERS.map((g) => (
                  <FilterChip key={g} label={g} selected={filters.gender === g} onPress={() => setField('gender', g)} />
                ))}
              </View>

              <Section label={t('details.conditions').toUpperCase()}>
                {CONDITIONS.map((c) => (
                  <FilterChip key={c} label={c} selected={filters.conditions.includes(c)} onPress={() => toggleField('conditions', c)} />
                ))}
              </Section>

              <Section label={t('details.approach').toUpperCase()}>
                {MODALITIES.map((m) => (
                  <FilterChip key={m} label={m} selected={filters.modalities.includes(m)} onPress={() => toggleField('modalities', m)} />
                ))}
              </Section>

              <Section label={t('details.populations').toUpperCase()}>
                {POPULATIONS.map((p) => (
                  <FilterChip key={p} label={p} selected={filters.populations.includes(p)} onPress={() => toggleField('populations', p)} />
                ))}
              </Section>
            </>
          )}

          <Button label={t('details.showMatches')} onPress={() => setStep('results')} style={{ marginTop: 18 }} />
        </>
      )}

      {step === 'results' && (
        <>
          <View style={styles.resHead}>
            <Text style={[styles.resN, { color: colors.primary }]}>
              {t(`results.count_${filters.path}`, { count: results.length })}
              {selectedState ? t('results.inState', { state: selectedState }) : ''}
            </Text>
            <TouchableOpacity onPress={() => setStep('details')}>
              <Text style={[styles.edit, { color: colors.primary }]}>{t('results.edit')}</Text>
            </TouchableOpacity>
          </View>
          {filters.insurance.length + filters.conditions.length + filters.modalities.length > 0 && (
            <Text style={[styles.sum, { color: colors.inkSoft }]}>
              {t('results.filters', {
                list: [...filters.insurance.map(displayInsurance), ...filters.conditions, ...filters.modalities].join(' · '),
              })}
            </Text>
          )}

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
          ) : results.length === 0 ? (
            <Text style={[styles.sum, { color: colors.inkSoft, marginTop: 16 }]}>
              {t('results.empty')}
            </Text>
          ) : (
            results.map((p) => (
              <ProviderCard key={p.id} provider={p} onPress={() => router.push(`/finder/${p.id}`)} />
            ))
          )}

          {alsoRecommended.length > 0 && (
            <>
              <Text style={[styles.h2, { color: colors.inkSoft, marginTop: 22 }]}>{t('results.also').toUpperCase()}</Text>
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
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>{t('details.stateModalTitle')}</Text>
            <TouchableOpacity onPress={() => setStateOpen(false)}>
              <Text style={[styles.sheetDone, { color: colors.primary }]}>{t('details.stateModalDone')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {STATES.map((s) => {
              const sel = (filters.state || ANY_STATE) === s;
              return (
                <TouchableOpacity
                  key={s}
                  onPress={() => { setField('state', s); setStateOpen(false); }}
                  style={[styles.sheetRow, { borderBottomColor: colors.line, backgroundColor: sel ? colors.primaryLight : 'transparent' }]}
                >
                  <Text style={[styles.sheetRowText, { color: sel ? colors.primary : colors.ink, fontWeight: sel ? '600' : '400' }]}>{displayState(s)}</Text>
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
