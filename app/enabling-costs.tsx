import React, { useMemo, useState } from 'react';
import {
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useTheme } from '../src/contexts/ThemeContext';
import {
  calculateEnablingCosts,
  type CostCategoryId,
  type CostItemId,
  type CostValues,
} from '../src/lib/enablingCostWorksheet';

type WorksheetStep = 'estimate' | 'reflection' | 'plan';
type WorksheetOption = { id: string; label: string };
type WorksheetCategory = {
  id: CostCategoryId;
  title: string;
  body: string;
  items: Array<{ id: CostItemId; label: string; hint: string }>;
};

function SelectionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      activeOpacity={0.78}
      onPress={onPress}
      style={[
        styles.selectionRow,
        {
          backgroundColor: selected ? colors.primaryLight : colors.white,
          borderColor: selected ? colors.primary : colors.line,
        },
      ]}
    >
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: selected ? colors.primary : colors.white,
            borderColor: selected ? colors.primary : colors.line,
          },
        ]}
      >
        {selected ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
      <Text style={[styles.selectionLabel, { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function EnablingCostsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('enablingCosts');
  const [step, setStep] = useState<WorksheetStep>('estimate');
  const [values, setValues] = useState<CostValues>({});
  const [fundSelections, setFundSelections] = useState<Set<string>>(new Set());
  const [pauseSelections, setPauseSelections] = useState<Set<string>>(new Set());
  const [boundary, setBoundary] = useState('');

  const categories = t('categories', { returnObjects: true }) as unknown as WorksheetCategory[];
  const fundOptions = t('reflection.fundOptions', { returnObjects: true }) as unknown as WorksheetOption[];
  const pauseOptions = t('reflection.pauseOptions', { returnObjects: true }) as unknown as WorksheetOption[];
  const calculation = useMemo(() => calculateEnablingCosts(values), [values]);
  const stepNumber = step === 'estimate' ? 1 : step === 'reflection' ? 2 : 3;
  const planHasContent = fundSelections.size > 0 || pauseSelections.size > 0 || boundary.trim().length > 0;

  const money = (amount: number) =>
    new Intl.NumberFormat(i18n.language.startsWith('es') ? 'es-US' : 'en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(Math.round(amount));

  const toggleSelection = (
    id: string,
    current: Set<string>,
    update: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const handleBack = () => {
    if (step === 'plan') setStep('reflection');
    else if (step === 'reflection') setStep('estimate');
    else router.back();
  };

  const startOver = () => {
    setValues({});
    setFundSelections(new Set());
    setPauseSelections(new Set());
    setBoundary('');
    setStep('estimate');
  };

  const selectedLabels = (options: WorksheetOption[], selected: Set<string>) =>
    options.filter((option) => selected.has(option.id)).map((option) => option.label);

  const sharePlan = async () => {
    const fundLabels = selectedLabels(fundOptions, fundSelections);
    const pauseLabels = selectedLabels(pauseOptions, pauseSelections);
    const sections = [
      t('plan.shareTitle'),
      t('plan.shareIntro', { total: money(calculation.total) }),
      '',
      t('plan.shareFund'),
      ...(fundLabels.length ? fundLabels.map((label) => `• ${label}`) : [`• ${t('plan.noneSelected')}`]),
      '',
      t('plan.sharePause'),
      ...(pauseLabels.length ? pauseLabels.map((label) => `• ${label}`) : [`• ${t('plan.noneSelected')}`]),
      ...(boundary.trim() ? ['', t('plan.shareBoundary', { boundary: boundary.trim() })] : []),
    ];
    await Share.share({ title: t('plan.shareTitle'), message: sections.join('\n') });
  };

  const largestCategory = categories.find((category) => category.id === calculation.largestCategory);

  return (
    <ScreenContainer
      backgroundColor={colors.cream}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.screen}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={handleBack}
          style={[styles.backButton, { borderColor: colors.line, backgroundColor: colors.white }]}
        >
          <Text style={[styles.backArrow, { color: colors.ink }]}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: colors.ink }]}>{t('header')}</Text>
          <Text style={[styles.progress, { color: colors.inkSoft }]}>
            {t('progress', { current: stepNumber })}
          </Text>
        </View>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: colors.line }]}>
        <View
          style={[
            styles.progressFill,
            { backgroundColor: colors.primary, width: `${stepNumber * 33.333}%` },
          ]}
        />
      </View>

      {step === 'estimate' ? (
        <>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('estimate.eyebrow')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('estimate.title')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('estimate.body')}</Text>

          <View style={[styles.notice, { backgroundColor: colors.greenLight, borderColor: colors.green }]}>
            <Text style={styles.noticeIcon}>🔒</Text>
            <View style={styles.noticeCopy}>
              <Text style={[styles.noticeText, { color: colors.ink }]}>{t('estimate.privacy')}</Text>
              <Text style={[styles.noticeSub, { color: colors.inkSoft }]}>{t('estimate.timeframe')}</Text>
            </View>
          </View>

          {categories.map((category) => (
            <View key={category.id} style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <View style={styles.categoryHeader}>
                <View style={styles.categoryCopy}>
                  <Text style={[styles.cardTitle, { color: colors.ink }]}>{category.title}</Text>
                  <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{category.body}</Text>
                </View>
                <Text style={[styles.subtotal, { color: colors.primary }]}>
                  {money(calculation.categoryTotals[category.id])}
                </Text>
              </View>

              {category.items.map((item) => (
                <View key={item.id} style={[styles.costRow, { borderTopColor: colors.line }]}>
                  <View style={styles.costCopy}>
                    <Text style={[styles.costLabel, { color: colors.ink }]}>{item.label}</Text>
                    <Text style={[styles.costHint, { color: colors.inkSoft }]}>{item.hint}</Text>
                  </View>
                  <View style={[styles.moneyInputWrap, { borderColor: colors.line, backgroundColor: colors.cream }]}>
                    <Text style={[styles.dollar, { color: colors.inkSoft }]}>$</Text>
                    <TextInput
                      accessibilityLabel={`${item.label}. ${item.hint}`}
                      value={String(values[item.id] ?? '')}
                      onChangeText={(next) => setValues((current) => ({
                        ...current,
                        [item.id]: next.replace(/[^0-9]/g, ''),
                      }))}
                      keyboardType="number-pad"
                      maxLength={9}
                      placeholder="0"
                      placeholderTextColor={colors.inkSoft}
                      selectTextOnFocus
                      style={[styles.moneyInput, { color: colors.ink }]}
                    />
                  </View>
                </View>
              ))}
            </View>
          ))}

          <View style={[styles.totalCard, { backgroundColor: colors.primaryDark }]}>
            <Text style={styles.totalLabel}>{t('estimate.runningTotal')}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.totalAmount}>{money(calculation.total)}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: calculation.total === 0 }}
              disabled={calculation.total === 0}
              onPress={() => setStep('reflection')}
              activeOpacity={0.85}
              style={[
                styles.primaryButton,
                { backgroundColor: calculation.total > 0 ? colors.secondary : colors.line },
              ]}
            >
              <Text style={styles.primaryButtonText}>{t('estimate.continue')}</Text>
            </TouchableOpacity>
            {calculation.total === 0 ? <Text style={styles.disabledHint}>{t('estimate.empty')}</Text> : null}
          </View>
        </>
      ) : null}

      {step === 'reflection' ? (
        <>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('reflection.eyebrow')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('reflection.title')}</Text>

          <View style={[styles.resultCard, { backgroundColor: colors.primaryDark }]}>
            <Text style={styles.resultLabel}>{t('reflection.totalLabel')}</Text>
            <Text style={styles.resultTotal}>{money(calculation.total)}</Text>
            <View style={styles.metricsRow}>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{money(calculation.monthlyAverage)}</Text>
                <Text style={styles.metricLabel}>{t('reflection.monthlyLabel')}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{money(calculation.fiveYearProjection)}</Text>
                <Text style={styles.metricLabel}>{t('reflection.projectionLabel')}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            {categories.map((category) => {
              const pct = calculation.total > 0
                ? Math.round((calculation.categoryTotals[category.id] / calculation.total) * 100)
                : 0;
              return (
                <View key={category.id} style={styles.breakdownRow}>
                  <View style={styles.breakdownLabelRow}>
                    <Text style={[styles.breakdownLabel, { color: colors.ink }]}>{category.title}</Text>
                    <Text style={[styles.breakdownValue, { color: colors.inkSoft }]}>
                      {money(calculation.categoryTotals[category.id])}
                    </Text>
                  </View>
                  <View style={[styles.barTrack, { backgroundColor: colors.line }]}>
                    <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: colors.secondary }]} />
                  </View>
                </View>
              );
            })}
            {largestCategory ? (
              <Text style={[styles.largestText, { color: colors.inkSoft }]}>
                {t('reflection.largestLabel')}: <Text style={{ color: colors.ink, fontWeight: '700' }}>{largestCategory.title}</Text>
              </Text>
            ) : null}
          </View>

          <View style={[styles.contextCard, { backgroundColor: colors.secondaryLight, borderColor: colors.secondary }]}>
            <Text style={[styles.contextText, { color: colors.ink }]}>{t('reflection.context')}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('reflection.fundTitle')}</Text>
            <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('reflection.fundBody')}</Text>
            {fundOptions.map((option) => (
              <SelectionRow
                key={option.id}
                label={option.label}
                selected={fundSelections.has(option.id)}
                onPress={() => toggleSelection(option.id, fundSelections, setFundSelections)}
              />
            ))}
          </View>

          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('reflection.pauseTitle')}</Text>
            <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('reflection.pauseBody')}</Text>
            {pauseOptions.map((option) => (
              <SelectionRow
                key={option.id}
                label={option.label}
                selected={pauseSelections.has(option.id)}
                onPress={() => toggleSelection(option.id, pauseSelections, setPauseSelections)}
              />
            ))}
          </View>

          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('reflection.boundaryTitle')}</Text>
            <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('reflection.boundaryBody')}</Text>
            <TextInput
              accessibilityLabel={t('reflection.boundaryTitle')}
              value={boundary}
              onChangeText={setBoundary}
              multiline
              maxLength={240}
              placeholder={t('reflection.boundaryPlaceholder')}
              placeholderTextColor={colors.inkSoft}
              style={[styles.boundaryInput, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.cream }]}
            />
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: !planHasContent }}
            disabled={!planHasContent}
            onPress={() => setStep('plan')}
            activeOpacity={0.85}
            style={[
              styles.primaryButton,
              { backgroundColor: planHasContent ? colors.primary : colors.line },
            ]}
          >
            <Text style={styles.primaryButtonText}>{t('reflection.continue')}</Text>
          </TouchableOpacity>
          {!planHasContent ? <Text style={[styles.formHint, { color: colors.inkSoft }]}>{t('reflection.selectionNeeded')}</Text> : null}
        </>
      ) : null}

      {step === 'plan' ? (
        <>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('plan.eyebrow')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('plan.title')}</Text>

          <View style={[styles.planCard, { backgroundColor: colors.white, borderColor: colors.primary }]}>
            <Text style={[styles.planEstimateLabel, { color: colors.inkSoft }]}>{t('plan.estimateLabel')}</Text>
            <Text style={[styles.planEstimate, { color: colors.primary }]}>{money(calculation.total)}</Text>

            <View style={[styles.planSection, { borderTopColor: colors.line }]}>
              <Text style={[styles.planHeading, { color: colors.green }]}>{t('plan.willFund')}</Text>
              {selectedLabels(fundOptions, fundSelections).map((label) => (
                <Text key={label} style={[styles.planLine, { color: colors.ink }]}>✓ {label}</Text>
              ))}
              {fundSelections.size === 0 ? <Text style={[styles.planLine, { color: colors.inkSoft }]}>{t('plan.noneSelected')}</Text> : null}
            </View>

            <View style={[styles.planSection, { borderTopColor: colors.line }]}>
              <Text style={[styles.planHeading, { color: colors.coral }]}>{t('plan.willPause')}</Text>
              {selectedLabels(pauseOptions, pauseSelections).map((label) => (
                <Text key={label} style={[styles.planLine, { color: colors.ink }]}>• {label}</Text>
              ))}
              {pauseSelections.size === 0 ? <Text style={[styles.planLine, { color: colors.inkSoft }]}>{t('plan.noneSelected')}</Text> : null}
            </View>

            {boundary.trim() ? (
              <View style={[styles.boundaryQuote, { backgroundColor: colors.primaryLight, borderLeftColor: colors.primary }]}>
                <Text style={[styles.planHeading, { color: colors.primary }]}>{t('plan.myBoundary')}</Text>
                <Text style={[styles.boundaryQuoteText, { color: colors.ink }]}>{boundary.trim()}</Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.nextStep, { color: colors.inkSoft }]}>{t('plan.nextStep')}</Text>

          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/scripts')}
            activeOpacity={0.85}
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.primaryButtonText}>{t('plan.practice')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => void sharePlan()}
            activeOpacity={0.85}
            style={[styles.secondaryButton, { backgroundColor: colors.white, borderColor: colors.primary }]}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>{t('plan.share')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={startOver} style={styles.textButton}>
            <Text style={[styles.textButtonText, { color: colors.inkSoft }]}>{t('plan.startOver')}</Text>
          </TouchableOpacity>
        </>
      ) : null}

      <Text style={[styles.disclaimer, { color: colors.inkSoft }]}>{t('disclaimer')}</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 12, paddingBottom: 56 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  backButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 32, lineHeight: 34, marginTop: -2 },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 19, fontWeight: '800' },
  progress: { fontSize: 12, marginTop: 2 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 28 },
  progressFill: { height: 4, borderRadius: 2 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 7 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.7, marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 18 },
  notice: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 14, gap: 10, marginBottom: 16 },
  noticeIcon: { fontSize: 18 },
  noticeCopy: { flex: 1 },
  noticeText: { fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
  noticeSub: { fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  card: { borderRadius: 18, borderWidth: 1, padding: 17, marginBottom: 14 },
  categoryHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  categoryCopy: { flex: 1 },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800', marginBottom: 4 },
  cardBody: { fontSize: 13.5, lineHeight: 19, marginBottom: 12 },
  subtotal: { fontSize: 15, fontWeight: '800' },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingVertical: 13 },
  costCopy: { flex: 1 },
  costLabel: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  costHint: { fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  moneyInputWrap: { width: 96, minHeight: 44, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  dollar: { fontSize: 14, fontWeight: '700' },
  moneyInput: { flex: 1, fontSize: 16, fontWeight: '700', textAlign: 'right', paddingVertical: 8 },
  totalCard: { borderRadius: 20, padding: 20, alignItems: 'center', marginTop: 2, marginBottom: 18 },
  totalLabel: { color: '#d9e3ed', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  totalAmount: { color: '#fff', fontSize: 38, fontWeight: '900', marginTop: 5, marginBottom: 16 },
  primaryButton: { width: '100%', minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  disabledHint: { color: '#d9e3ed', fontSize: 12, marginTop: 9, textAlign: 'center' },
  resultCard: { borderRadius: 20, padding: 22, alignItems: 'center', marginTop: 4, marginBottom: 14 },
  resultLabel: { color: '#d9e3ed', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  resultTotal: { color: '#fff', fontSize: 42, fontWeight: '900', marginTop: 4, marginBottom: 20 },
  metricsRow: { flexDirection: 'row', width: '100%', gap: 10 },
  metric: { flex: 1, borderRadius: 12, padding: 12, backgroundColor: 'rgba(255,255,255,0.09)' },
  metricValue: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  metricLabel: { color: '#d9e3ed', fontSize: 10.5, lineHeight: 14 },
  breakdownRow: { marginBottom: 14 },
  breakdownLabelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  breakdownLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  breakdownValue: { fontSize: 13, fontWeight: '700' },
  barTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 4 },
  largestText: { fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  contextCard: { borderRadius: 16, borderWidth: 1, padding: 17, marginBottom: 14 },
  contextText: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  selectionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 11, padding: 12, marginTop: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '900' },
  selectionLabel: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
  boundaryInput: { minHeight: 112, borderWidth: 1, borderRadius: 12, padding: 13, fontSize: 14, lineHeight: 21, textAlignVertical: 'top' },
  formHint: { fontSize: 12, textAlign: 'center', marginTop: 9, marginBottom: 12 },
  planCard: { borderRadius: 20, borderWidth: 1.5, padding: 20, marginTop: 5, marginBottom: 18 },
  planEstimateLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  planEstimate: { fontSize: 36, fontWeight: '900', marginTop: 3, marginBottom: 14 },
  planSection: { borderTopWidth: 1, paddingTop: 15, marginTop: 8 },
  planHeading: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 9 },
  planLine: { fontSize: 14, lineHeight: 21, marginBottom: 5 },
  boundaryQuote: { borderLeftWidth: 4, borderRadius: 10, padding: 14, marginTop: 16 },
  boundaryQuoteText: { fontSize: 16, lineHeight: 23, fontWeight: '700' },
  nextStep: { fontSize: 14, lineHeight: 21, marginBottom: 18 },
  secondaryButton: { width: '100%', minHeight: 50, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 10 },
  secondaryButtonText: { fontSize: 15, fontWeight: '800' },
  textButton: { alignItems: 'center', paddingVertical: 16 },
  textButtonText: { fontSize: 14, fontWeight: '700' },
  disclaimer: { fontSize: 10.5, lineHeight: 16, textAlign: 'center', marginTop: 20 },
});
