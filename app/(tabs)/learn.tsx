import { useToolOpened } from '../../src/hooks/useToolOpened';
import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { TabHeader } from '../../src/components/ui/TabHeader';
import { buttonShape } from '../../src/components/ui/Button';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { useWebSSO } from '../../src/hooks/useWebSSO';
import { useFeatureAccess } from '../../src/hooks/useFeatureAccess';
import { WEBSITE_PATHS } from '../../src/lib/websiteLinks';
import { plansHref } from '../../src/lib/membershipPath';
import { useLovedOne } from '../../src/hooks/useLovedOne';
import { useSituation } from '../../src/hooks/useSituation';
import { normalizeRecoveryPhase } from '../../src/lib/recoveryPathway';
import { TOOL_IDS, toolsForPhase, type ToolId } from '../../src/lib/toolsForPhase';
import { TodayDisclosure } from '../../src/components/today/TodayDisclosure';


type ContentSection = { key: 'education' | 'recordings'; path: string };
type FaqItem = { q: string; a: string };

// Members-only soberhelpline.com pages, opened in the browser already signed in.
const SECTIONS: ContentSection[] = [
  { key: 'education', path: WEBSITE_PATHS.familyEducation },
  { key: 'recordings', path: WEBSITE_PATHS.zoomRecordings },
];

function FaqRow({ item, colors }: { item: FaqItem; colors: ReturnType<typeof useTheme>['colors'] }) {
  const { t } = useTranslation('learn');
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.faqRow, { borderBottomColor: colors.line }]}>
      <TouchableOpacity
        style={styles.faqHead}
        activeOpacity={0.75}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={item.q}
        accessibilityHint={open ? t('faq.collapseHint') : t('faq.expandHint')}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.faqQ, { color: colors.ink }]}>{item.q}</Text>
        <Text accessible={false} style={[styles.faqToggle, { color: colors.inkSoft }]}>{open ? '−' : '+'}</Text>
      </TouchableOpacity>
      {open && <Text style={[styles.faqA, { color: colors.inkSoft }]}>{item.a}</Text>}
    </View>
  );
}

export default function LearnScreen() {
  useToolOpened('learn');
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('learn');
  // AyudaSobria's library (/recursos) is public and La Sobremesa is not
  // recorded: Spanish members get the library card and no recordings pitch.
  const spanish = i18n.language.startsWith('es');
  const sections = spanish ? SECTIONS.filter(({ key }) => key === 'education') : SECTIONS;
  const { user, entitlements } = useAccount();
  const canUseDiyIntervention = useFeatureAccess('diyIntervention');
  // Where her loved one is (the phase she set on Today) and how things are
  // now (the situation band) pick the tools shown first.
  const { lovedOne, loading: lovedOneLoading } = useLovedOne(user?.id ?? null);
  const { situation, loaded: situationLoaded } = useSituation(user?.id ?? null);
  const phase = lovedOne?.stage ? normalizeRecoveryPhase(lovedOne.stage, lovedOne.status) : null;
  const { forNow, others } = toolsForPhase(phase, situationLoaded ? situation.band : null);
  // Not before the loved-one record has loaded, so the picks never jump.
  // Every tool stays under "All tools".
  const showForNow = !lovedOneLoading;
  const allTools: readonly ToolId[] = showForNow ? others : TOOL_IDS;
  const router = useRouter();
  const { openWithSSO } = useWebSSO();
  const [faqQuery, setFaqQuery] = useState('');

  const faqItems = useMemo(
    () => t('faq.items', { returnObjects: true }) as FaqItem[],
    [t],
  );
  const filteredFaq = useMemo(() => {
    const q = faqQuery.trim().toLowerCase();
    if (!q) return faqItems;
    return faqItems.filter(
      (item) => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q),
    );
  }, [faqItems, faqQuery]);

  // Every tool card, as before; the order and the split come from toolsForPhase.
  const toolCards: Record<ToolId, React.ReactNode> = {
    invitation: (
      <View key="invitation" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.coral }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>💌</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.coral }]}>{t('tools.invitationBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.invitationTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.invitationBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.invitationButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/invitation-engine' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.invitationButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    actionPlan: (
      <View key="actionPlan" style={[styles.featuredTool, { backgroundColor: colors.primaryDark }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>✅</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.coral }]}>{t('tools.actionBadge')}</Text>
        </View>
        <Text style={styles.featuredTitle}>{t('tools.actionTitle')}</Text>
        <Text style={styles.featuredBody}>{t('tools.actionBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.actionButton')}
          // On the navy card a navy button would not show: the same button turned inside out, white with navy words.
          style={[styles.cardButton, { backgroundColor: colors.white }]}
          onPress={() => router.push('/treatment-action-plan' as never)}
          activeOpacity={0.85}
        >
          <Text style={[styles.cardButtonText, { color: colors.primary }]}>{t('tools.actionButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    diy: (
      <View key="diy" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.primary }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🧭</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.primary }]}>{t('tools.diyBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.diyTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.diyBody')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t(canUseDiyIntervention ? 'tools.diyIncluded' : 'tools.diyPaid')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={!canUseDiyIntervention ? t('tools.diyLockedButton') : t('tools.diyButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/diy-intervention-planner' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{!canUseDiyIntervention ? t('tools.diyLockedButton') : t('tools.diyButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    homecoming: (
      <View key="homecoming" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.coral }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🏠</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.coral }]}>{t('tools.homecomingBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.homecomingTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.homecomingBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.homecomingButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/homecoming-week' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.homecomingButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    visitation: (
      <View key="visitation" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.primary }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🕰️</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.primary }]}>{t('tools.visitationBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.visitationTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.visitationBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.visitationButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/family-visitation-plan' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.visitationButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    holiday: (
      <View key="holiday" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.coral }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🕯️</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.coral }]}>{t('tools.holidayBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.holidayTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.holidayBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.holidayButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/holiday-plan' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.holidayButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    prosecutor: (
      <View key="prosecutor" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.primary }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>⚖️</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.primary }]}>{t('tools.prosecutorBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.prosecutorTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.prosecutorBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.prosecutorButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/prosecutor-letter' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.prosecutorButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    choose: (
      <View key="choose" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.green }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🔎</Text>
          <Text style={[styles.toolBadge, { color: colors.green, backgroundColor: colors.greenLight }]}>{t('tools.chooseBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.chooseTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.chooseBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.chooseButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/choose-treatment' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.chooseButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    costs: (
      <View key="costs" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>💵</Text>
          <Text style={[styles.toolBadge, { color: colors.ink, backgroundColor: colors.secondary }]}>{t('tools.costBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.costTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.costBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.costButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/enabling-costs' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.costButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
    safety: (
      <View key="safety" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.green }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🛟</Text>
          <Text style={[styles.toolBadge, { color: colors.green, backgroundColor: colors.greenLight }]}>{t('tools.safetyBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.safetyTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.safetyBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.safetyButton')}
          // Safety is the one place a coral button belongs (as on the Safety button above the tab bar).
          style={[styles.cardButton, { backgroundColor: colors.coral }]}
          onPress={() => router.push('/safety-wallet' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.safetyButton')}</Text>
        </TouchableOpacity>
      </View>
    ),
  };

  return (
    <ScreenContainer scroll contentContainerStyle={styles.inner}>
      <TabHeader title={t('header')} />

      <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('intro')}</Text>
      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text accessibilityRole="header" style={[styles.cardTitle, { color: colors.ink }]}>{t('destinations.title')}</Text>
        {([
          ['conversation', '/(tabs)/scripts'],
          ['boundaries', '/(tabs)/scripts?section=boundaries'],
          ['treatment', '/finder'],
          ['someone', '/(tabs)/support'],
        ] as const).map(([key, route]) => (
          <TouchableOpacity key={key} accessibilityRole="button" onPress={() => router.push(route as never)} style={styles.destination}>
            <Text style={[styles.cardButtonText, { color: colors.primary, textAlign: 'left' }]}>{t(`destinations.${key}`)} →</Text>
          </TouchableOpacity>
        ))}
      </View>
      {showForNow && (
        <>
          <Text accessibilityRole="header" style={[styles.sectionEyebrow, { color: colors.inkSoft }]}>{t('tools.forNowEyebrow')}</Text>
          <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.forNowBody')}</Text>
          {forNow.map((tool) => toolCards[tool])}
        </>
      )}

      {/* Every other tool, one tap away: each keeps its own gate and badge. */}
      <View style={styles.disclosure}>
        <TodayDisclosure title={t('tools.allTitle')}>
          {allTools.map((tool) => toolCards[tool])}
        </TodayDisclosure>
      </View>

      <Text accessibilityRole="header" style={[styles.sectionEyebrow, { color: colors.inkSoft }]}>{t('tools.learningEyebrow')}</Text>

      {entitlements.canAccessLearningContent ? (
        <>
          {/* The website library and recordings are members-only pages; for
              everyone else they would be a website paywall, so free members
              see where the library lives and the in-app plans instead. */}
          {entitlements.canAccessGroups || spanish ? sections.map(({ key, path }) => (
            <View key={key} style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>{t(`${key}.title`)}</Text>
              <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t(`${key}.body`)}</Text>
              <TouchableOpacity
                accessibilityRole="link"
                accessibilityLabel={t(`${key}.button`)}
                style={[styles.cardButton, { backgroundColor: colors.primary }]}
                onPress={() => void openWithSSO(user?.id ?? null, path)}
                activeOpacity={0.85}
              >
                <Text style={styles.cardButtonText}>{t(`${key}.button`)}</Text>
              </TouchableOpacity>
            </View>
          )) : (
            <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('membersLibrary.title')}</Text>
              <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('membersLibrary.body')}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('membersLibrary.button')}
                style={[styles.cardButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push(plansHref('learn_library'))}
                activeOpacity={0.85}
              >
                <Text style={styles.cardButtonText}>{t('membersLibrary.button')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* In-app answers to the questions every family asks — no web round-trip. Starts closed. */}
          <View style={styles.disclosure}>
            <TodayDisclosure title={t('faq.eyebrow')}>
              <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
                <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('faq.sub')}</Text>
                <View style={[styles.faqSearch, { borderColor: colors.line }]}>
                  <Text style={styles.faqSearchIcon}>🔍</Text>
                  <TextInput
                    style={[styles.faqSearchInput, { color: colors.ink }]}
                    value={faqQuery}
                    onChangeText={setFaqQuery}
                    placeholder={t('faq.eyebrow')}
                    placeholderTextColor={colors.inkSoft}
                    autoCorrect={false}
                    accessibilityLabel={t('faq.eyebrow')}
                  />
                </View>
                {filteredFaq.map((item) => (
                  <FaqRow key={item.q} item={item} colors={colors} />
                ))}
              </View>
            </TodayDisclosure>
          </View>
        </>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  destination: { minHeight: 44, justifyContent: 'center', paddingVertical: 10 },
  // Side and top padding are ScreenContainer's own, as on every other tab, so
  // the shared header sits in the same place here.
  inner: { paddingBottom: 40 },
  disclosure: { marginBottom: 16 },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  featuredTool: {
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
  },
  toolTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  toolIcon: { fontSize: 25 },
  toolBadge: {
    color: '#fff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 10.5,
    fontWeight: '800',
  },
  featuredTitle: { color: '#fff', fontSize: 20, lineHeight: 25, fontWeight: '800', marginBottom: 7 },
  featuredBody: { color: '#d9e3ed', fontSize: 14, lineHeight: 20, marginBottom: 17 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  cardBody: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  // The app's one button shape (buttonShape), sized to its words.
  cardButton: { ...buttonShape, alignSelf: 'flex-start', paddingVertical: 10 },
  cardButtonText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  faqSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 6,
  },
  faqSearchIcon: { fontSize: 13 },
  faqSearchInput: { flex: 1, fontSize: 13.5, padding: 0 },
  faqRow: { paddingVertical: 13, borderBottomWidth: 1 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  faqQ: { flex: 1, fontSize: 14.5, fontWeight: '600', lineHeight: 20 },
  faqToggle: { fontSize: 18, fontWeight: '600' },
  faqA: { fontSize: 13.5, lineHeight: 20, marginTop: 9 },
});
