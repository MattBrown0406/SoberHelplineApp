import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Linking,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../src/contexts/AccountContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useLanguage } from '../../src/hooks/useLanguage';
import {
  getMockOnCallRoster,
  getMockSupportGroups,
} from '../../src/api/mock';
import { useSessions, type DbSession } from '../../src/hooks/useSessions';
import { useGroupPresence } from '../../src/hooks/useGroupPresence';
import { useGroupRsvps } from '../../src/hooks/useGroupRsvps';
import { GROUPS_URL, FEATURED_PROVIDER } from '../../src/config';
import { useIAP } from '../../src/hooks/useIAP';
import { useSituation } from '../../src/hooks/useSituation';
import { funnelDoor, type FunnelDoor } from '../../src/lib/situation';
import { SituationOffRamp } from '../../src/components/situation/SituationOffRamp';
import { logFunnelEvent } from '../../src/lib/funnel';
import type { StaffMember, SupportGroup } from '../../src/api/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function roleLabel(staff: StaffMember): string {
  return staff.roleLabel;
}

function sessionTypeKey(kind: DbSession['kind'], t: (k: string) => string): string {
  if (kind === 'group') return t('sessions.typeGroup');
  if (kind === 'one-on-one') return t('sessions.typeOneOnOne');
  return t('sessions.typeFamily');
}

// ── Crisis sheet ─────────────────────────────────────────────────────────────

const CRISIS_LINE_TEL = 'tel:+15038362136'; // Sober Helpline guidance line — v1 direct dial; Twilio cascade is P2

function CrisisSheet({
  visible,
  onClose,
  isAttached,
  onMessage,
  door,
  t,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  isAttached: boolean;
  onMessage: () => void;
  door: FunnelDoor;
  t: (key: string) => string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { width: screenWidth } = useWindowDimensions();
  const sheetOffset = Math.max(0, (screenWidth - 520) / 2);
  const roster = getMockOnCallRoster(isAttached ? 'attached' : 'direct');
  const primary = roster.primaryOnCall;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      />
      <View style={[styles.sheet, { backgroundColor: colors.white, left: sheetOffset, right: sheetOffset }]}>
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />

        <Text style={[styles.sheetTitle, { color: colors.ink }]}>
          {t('crisis.sheetTitle')}
        </Text>
        <Text style={[styles.sheetSub, { color: colors.inkSoft }]}>
          {primary.firstName} {isAttached ? t('crisis.attachedSub') : t('crisis.directSub')}
        </Text>

        <View style={[styles.sheetRow, { borderBottomColor: colors.line }]}>
          <View>
            <Text style={[styles.sheetRowName, { color: colors.ink }]}>
              {primary.firstName} {primary.lastName}
            </Text>
            {primary.credentialDisplay ? (
              <Text style={[styles.sheetRowSub, { color: colors.inkSoft }]}>
                {roleLabel(primary)} · {primary.credentialDisplay}
              </Text>
            ) : (
              <Text style={[styles.sheetRowSub, { color: colors.inkSoft }]}>
                {roleLabel(primary)}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.sheetActionBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
            onPress={() => {
              if (isAttached) {
                Linking.openURL(CRISIS_LINE_TEL);
              } else {
                onClose();
                onMessage();
              }
            }}
          >
            <Text style={styles.sheetActionBtnText}>
              {isAttached ? t('crisis.callButton') : t('crisis.messageButton')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.dividerRow, { borderTopColor: colors.line }]}>
          <Text style={[styles.dividerText, { color: colors.inkSoft }]}>
            {t('crisis.divider')}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.sheetRow, { borderBottomColor: colors.line }]}
          onPress={() => Linking.openURL(CRISIS_LINE_TEL)}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>{t('crisis.lineSh')}</Text>
          <Text style={[styles.sheetRowAction, { color: colors.primary }]}>{t('crisis.callButton')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sheetRow, styles.sheetRowLast, { borderBottomColor: colors.line }]}
          onPress={() => Linking.openURL('tel:911')}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>{t('crisis.line911')}</Text>
          <Text style={[styles.sheetRowAction, { color: colors.coral }]}>Call</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sheetRow, styles.sheetRowLast]}
          onPress={() => Linking.openURL('tel:988')}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>{t('crisis.line988')}</Text>
          <Text style={[styles.sheetRowAction, { color: colors.primary }]}>Call</Text>
        </TouchableOpacity>

        {/* Situation-aware next step — only for an escalated band, and only for
            self-guided members (attached families already have a provider).
            Always below the safety lines and never in their place. */}
        {door !== 'free_call' && !isAttached && (
          <View style={styles.offRampWrap}>
            <SituationOffRamp door={door} onBeforeNavigate={onClose} compact />
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Crisis protocol sheet ─────────────────────────────────────────────────────

type CrisisTab = 'overdose' | 'selfHarm' | 'unsafe';

function CrisisProtocolSheet({
  visible,
  onClose,
  t,
  colors,
  sheetOffset,
}: {
  visible: boolean;
  onClose: () => void;
  t: ReturnType<typeof useTranslation<'support'>>['t'];
  colors: ReturnType<typeof useTheme>['colors'];
  sheetOffset: number;
}) {
  const [tab, setTab] = useState<CrisisTab>('overdose');
  const tabs: { key: CrisisTab; label: string }[] = [
    { key: 'overdose', label: t('crisisProtocol.tabs.0') },
    { key: 'selfHarm', label: t('crisisProtocol.tabs.1') },
    { key: 'unsafe', label: t('crisisProtocol.tabs.2') },
  ];
  const section = t(`crisisProtocol.${tab}.title`);
  const steps = [
    t(`crisisProtocol.${tab}.steps.0`),
    t(`crisisProtocol.${tab}.steps.1`),
    t(`crisisProtocol.${tab}.steps.2`),
    t(`crisisProtocol.${tab}.steps.3`),
    t(`crisisProtocol.${tab}.steps.4`),
    t(`crisisProtocol.${tab}.steps.5`),
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.white, left: sheetOffset, right: sheetOffset }]}>
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
        <Text style={[styles.sheetTitle, { color: colors.ink }]}>
          {t('crisisProtocol.heading')}
        </Text>
        <Text style={[styles.sheetSub, { color: colors.inkSoft, marginBottom: 14 }]}>
          {t('crisisProtocol.sub')}
        </Text>

        {/* Tab bar */}
        <View style={[styles.protocolTabBar, { borderBottomColor: colors.line }]}>
          {tabs.map((tb) => (
            <TouchableOpacity
              key={tb.key}
              style={[
                styles.protocolTab,
                tab === tb.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
              ]}
              onPress={() => setTab(tb.key)}
            >
              <Text
                style={[
                  styles.protocolTabText,
                  { color: tab === tb.key ? colors.primary : colors.inkSoft },
                ]}
              >
                {tb.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Steps */}
        <View style={styles.protocolSteps}>
          <Text style={[styles.protocolSectionTitle, { color: colors.ink }]}>{section}</Text>
          {steps.map((step, i) => (
            <View key={i} style={styles.protocolStep}>
              <View style={[styles.protocolStepNum, { backgroundColor: colors.primary }]}>
                <Text style={styles.protocolStepNumText}>{i + 1}</Text>
              </View>
              <Text style={[styles.protocolStepText, { color: colors.ink }]}>{step}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={[styles.sheetRow, styles.sheetRowLast, { marginTop: 4 }]} onPress={onClose}>
          <Text style={[styles.sheetRowName, { color: colors.inkSoft }]}>
            {t('crisisProtocol.close')}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Provider sheet ────────────────────────────────────────────────────────────

function ProviderSheet({
  visible,
  onClose,
  t,
  colors,
  sheetOffset,
}: {
  visible: boolean;
  onClose: () => void;
  t: ReturnType<typeof useTranslation<'support'>>['t'];
  colors: ReturnType<typeof useTheme>['colors'];
  sheetOffset: number;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.white, left: sheetOffset, right: sheetOffset }]}>
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
        <Text style={[styles.sheetTitle, { color: colors.ink }]}>
          {t('providerSheet.title')}
        </Text>

        <View style={[styles.sheetRow, { borderBottomColor: colors.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sheetRowName, { color: colors.ink }]}>
              {FEATURED_PROVIDER.name} · {FEATURED_PROVIDER.org}
            </Text>
            <Text style={[styles.sheetRowSub, { color: colors.inkSoft }]}>
              {t('providerSheet.credential', {
                credential: FEATURED_PROVIDER.credential,
                credentialFull: FEATURED_PROVIDER.credentialFull,
              })}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.sheetRow, { borderBottomColor: colors.line }]}
          onPress={() => void Linking.openURL(`mailto:${FEATURED_PROVIDER.email}`)}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>
            {t('providerSheet.emailButton', { name: FEATURED_PROVIDER.name })}
          </Text>
          <Text style={[styles.sheetRowAction, { color: colors.primary }]}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sheetRow, styles.sheetRowLast, { borderBottomColor: colors.line }]}
          onPress={() => void Linking.openURL(FEATURED_PROVIDER.web)}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>
            {t('providerSheet.webButton')}
          </Text>
          <Text style={[styles.sheetRowAction, { color: colors.primary }]}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.sheetRow, styles.sheetRowLast]} onPress={onClose}>
          <Text style={[styles.sheetRowName, { color: colors.inkSoft }]}>
            {t('providerSheet.close')}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Upgrade sheet ─────────────────────────────────────────────────────────────

function UpgradeSheet({
  visible,
  onClose,
  onPurchase,
  purchasing,
  t,
  colors,
  sheetOffset,
}: {
  visible: boolean;
  onClose: () => void;
  onPurchase: () => void;
  purchasing: boolean;
  t: ReturnType<typeof useTranslation<'support'>>['t'];
  colors: ReturnType<typeof useTheme>['colors'];
  sheetOffset: number;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.white, left: sheetOffset, right: sheetOffset }]}>
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
        <Text style={[styles.sheetTitle, { color: colors.ink }]}>
          {t('upgradeSheet.title')}
        </Text>
        <Text style={[styles.tierPrice, { color: colors.ink, marginBottom: 12 }]}>
          {t('upgradeSheet.price')}
        </Text>

        <Text style={[styles.sheetSub, { color: colors.inkSoft, marginBottom: 6 }]}>
          {t('upgradeSheet.featuresHeader')}
        </Text>
        {(['feature1', 'feature2', 'feature3'] as const).map((key) => (
          <Text key={key} style={[styles.sheetSub, { color: colors.ink, marginBottom: 4 }]}>
            {'• '}{t(`upgradeSheet.${key}`)}
          </Text>
        ))}

        <Text style={[styles.sheetSub, { color: colors.inkSoft, marginTop: 12, marginBottom: 16 }]}>
          {t('upgradeSheet.note')}
        </Text>

        <TouchableOpacity
          style={[
            styles.solidBtn,
            { backgroundColor: purchasing ? colors.inkSoft : colors.primary },
          ]}
          activeOpacity={0.85}
          disabled={purchasing}
          onPress={onPurchase}
        >
          <Text style={styles.solidBtnText}>
            {purchasing ? '...' : t('upgradeSheet.subscribeButton')}
          </Text>
        </TouchableOpacity>

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => void Linking.openURL('https://soberhelpline.com/privacy')}>
            <Text style={[styles.legalLink, { color: colors.primary }]}>{t('upgradeSheet.privacyPolicy')}</Text>
          </TouchableOpacity>
          <Text style={[styles.legalSep, { color: colors.inkSoft }]}> · </Text>
          <TouchableOpacity onPress={() => void Linking.openURL('https://soberhelpline.com/terms')}>
            <Text style={[styles.legalLink, { color: colors.primary }]}>{t('upgradeSheet.termsOfUse')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.sheetRow, styles.sheetRowLast, { marginTop: 4 }]} onPress={onClose}>
          <Text style={[styles.sheetRowName, { color: colors.inkSoft }]}>
            {t('upgradeSheet.close')}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Staff chip ────────────────────────────────────────────────────────────────

function StaffChip({
  staff,
  label,
  colors,
}: {
  staff: StaffMember;
  label: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const initials = `${staff.firstName[0]}${staff.lastName[0]}`;
  return (
    <View style={styles.staffChip}>
      <View style={[styles.staffAvatar, { backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.staffInitials, { color: colors.primary }]}>{initials}</Text>
      </View>
      <View style={styles.staffInfo}>
        <Text style={[styles.staffName, { color: colors.ink }]}>
          {staff.firstName} {staff.lastName}
          {staff.credentialDisplay ? `, ${staff.credentialDisplay}` : ''}
        </Text>
        <Text style={[styles.staffRole, { color: colors.inkSoft }]}>
          {roleLabel(staff)}
          {staff.isOnCall ? ` · ${label}` : ''}
        </Text>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SupportScreen() {
  const { colors } = useTheme();
  const { user, isAttached, accountState, refreshAccount } = useAccount();
  const { t } = useTranslation('support');
  const { current, change, languages } = useLanguage();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const sheetOffset = Math.max(0, (screenWidth - 520) / 2);
  const { purchasePremium, purchaseEssential, purchasing } = useIAP();

  const [crisisOpen, setCrisisOpen] = useState(false);
  const [crisisProtocolOpen, setCrisisProtocolOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [questionSession, setQuestionSession] = useState<DbSession | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [questionSubmitted, setQuestionSubmitted] = useState(false);

  async function submitQuestion() {
    if (!questionText.trim() || !questionSession || !user?.id) return;
    setQuestionSubmitting(true);
    await supabase.from('session_questions').insert({
      account_id: user.id,
      session_id: questionSession.id,
      question: questionText.trim(),
    });
    setQuestionSubmitting(false);
    setQuestionSubmitted(true);
    setTimeout(() => {
      setQuestionSession(null);
      setQuestionText('');
      setQuestionSubmitted(false);
    }, 1500);
  }

  async function handlePurchase() {
    const success = await purchasePremium();
    if (success) {
      await refreshAccount();
      setUpgradeOpen(false);
    } else {
      Alert.alert(t('upgradeSheet.title'), t('upgradeSheet.iapError'));
    }
  }

  async function handlePurchaseEssential() {
    const success = await purchaseEssential();
    if (success) {
      await refreshAccount();
    } else {
      Alert.alert(t('upgradeSheet.title'), t('upgradeSheet.iapError'));
    }
  }

  const { situation } = useSituation(user?.id ?? null);
  const crisisDoor = funnelDoor(situation);

  const roster = getMockOnCallRoster(isAttached ? 'attached' : 'direct');
  const { sessions, toggleRsvp } = useSessions(user?.id ?? null);
  const groups = getMockSupportGroups();
  const { myRooms, liveRooms } = useGroupPresence(user?.id ?? null);
  const { rsvpedRooms, toggleRsvp: toggleGroupRsvp } = useGroupRsvps(user?.id ?? null);

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <CrisisSheet
        visible={crisisOpen}
        onClose={() => setCrisisOpen(false)}
        isAttached={isAttached}
        onMessage={() => router.push('/chat')}
        door={crisisDoor}
        t={t}
        colors={colors}
      />
      <CrisisProtocolSheet
        visible={crisisProtocolOpen}
        onClose={() => setCrisisProtocolOpen(false)}
        t={t}
        colors={colors}
        sheetOffset={sheetOffset}
      />
      <ProviderSheet
        visible={providerOpen}
        onClose={() => setProviderOpen(false)}
        t={t}
        colors={colors}
        sheetOffset={sheetOffset}
      />
      <UpgradeSheet
        visible={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onPurchase={() => void handlePurchase()}
        purchasing={purchasing}
        t={t}
        colors={colors}
        sheetOffset={sheetOffset}
      />

        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: colors.ink }]}>{t('header')}</Text>
          <TouchableOpacity onPress={() => router.push('/settings')} hitSlop={12}>
            <Text style={[styles.settingsIcon, { color: colors.inkSoft }]}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* Crisis button — always visible */}
        <TouchableOpacity
          style={[styles.sosButton, { backgroundColor: colors.coral }]}
          onPress={() => setCrisisOpen(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.sosText}>🆘  {t('crisis.button')}</Text>
        </TouchableOpacity>

        {/* Crisis protocol guide */}
        <TouchableOpacity
          style={[styles.protocolCard, { borderColor: colors.line, backgroundColor: colors.white }]}
          onPress={() => setCrisisProtocolOpen(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.protocolCardIcon}>📋</Text>
          <View style={styles.protocolCardBody}>
            <Text style={[styles.protocolCardEyebrow, { color: colors.inkSoft }]}>
              {t('crisisProtocol.eyebrow')}
            </Text>
            <Text style={[styles.protocolCardTitle, { color: colors.ink }]}>
              {t('crisisProtocol.heading')}
            </Text>
            <Text style={[styles.protocolCardSub, { color: colors.inkSoft }]}>
              {t('crisisProtocol.sub')}
            </Text>
          </View>
          <Text style={[styles.protocolCardArrow, { color: colors.inkSoft }]}>›</Text>
        </TouchableOpacity>

        {/* Treatment Finder entry */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push('/finder')}
          style={[styles.finderCard, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.finderTitle}>Find treatment & support</Text>
          <Text style={styles.finderSub}>
            Search vetted treatment centers, interventionists, and sober coaches — with real availability.
          </Text>
        </TouchableOpacity>

        {/* Attached: team + sessions */}
        {isAttached && (
          <>
            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('team.eyebrow')}
              </Text>
              <StaffChip
                staff={roster.primaryOnCall}
                label={t('team.onCall')}
                colors={colors}
              />
              {roster.available.map((s) => (
                <StaffChip key={s.id} staff={s} label="" colors={colors} />
              ))}
              <TouchableOpacity
                style={[styles.outlineBtn, { borderColor: colors.primary }]}
                activeOpacity={0.8}
                onPress={() => router.push('/chat')}
              >
                <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                  {t('team.messageButton')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('sessions.eyebrow')}
              </Text>
              {sessions.map((sess) => (
                <View key={sess.id} style={[styles.sessionOuter, { borderBottomColor: colors.line }]}>
                  <View style={styles.sessionRow}>
                    <View style={styles.sessionInfo}>
                      <Text style={[styles.sessionTitle, { color: colors.ink }]}>{sess.title}</Text>
                      <Text style={[styles.sessionMeta, { color: colors.inkSoft }]}>
                        {sessionTypeKey(sess.kind, t)} · {sess.schedule_label}
                      </Text>
                    </View>
                    {sess.rsvped && sess.zoom_url ? (
                      <TouchableOpacity
                        style={[styles.sessionBtn, { backgroundColor: colors.green, borderColor: colors.green }]}
                        activeOpacity={0.8}
                        onPress={() => {
                          if (sess.kind === 'group') logFunnelEvent('attended', { source: 'support' });
                          Linking.openURL(sess.zoom_url!);
                        }}
                      >
                        <Text style={[styles.sessionBtnText, { color: '#fff' }]}>{t('sessions.joinZoom')}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[styles.sessionBtn, { backgroundColor: sess.rsvped ? colors.greenLight : colors.primaryLight, borderColor: sess.rsvped ? colors.green : colors.primary }]}
                      activeOpacity={0.8}
                      onPress={() => toggleRsvp(sess)}
                    >
                      <Text style={[styles.sessionBtnText, { color: sess.rsvped ? colors.green : colors.primary }]}>
                        {sess.rsvped ? t('sessions.confirmButton') : t('sessions.rsvpButton')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {sess.rsvped && (
                    <TouchableOpacity
                      style={[styles.questionBtn, { borderColor: colors.primary }]}
                      activeOpacity={0.8}
                      onPress={() => setQuestionSession(sess)}
                    >
                      <Text style={[styles.questionBtnText, { color: colors.primary }]}>
                        {t('questionModal.button')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>

            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('membership.eyebrow')}
              </Text>
              <View style={styles.membershipRow}>
                <View style={[styles.coveredChip, { backgroundColor: colors.greenLight }]}>
                  <Text style={[styles.coveredText, { color: colors.green }]}>
                    {t('membership.covered')}
                  </Text>
                </View>
                <Text style={[styles.membershipSub, { color: colors.inkSoft }]}>
                  {t('membership.coveredSub')}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Free tier: Monday group + upgrade card */}
        {!isAttached && accountState === 'direct-free' && (
          <>
            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('mondayGroup.eyebrow')}
              </Text>
              <Text style={[styles.referralTitle, { color: colors.ink }]}>
                {t('mondayGroup.heading')}
              </Text>
              <Text style={[styles.referralBody, { color: colors.inkSoft }]}>
                {t('mondayGroup.sub')}
              </Text>
              {sessions.filter((s) => s.kind === 'group').map((sess) => (
                <View key={sess.id} style={[styles.sessionOuter, { borderBottomColor: colors.line }]}>
                  <View style={styles.sessionRow}>
                    <View style={styles.sessionInfo}>
                      <Text style={[styles.sessionTitle, { color: colors.ink }]}>{sess.title}</Text>
                      <Text style={[styles.sessionMeta, { color: colors.inkSoft }]}>
                        {sess.schedule_label}
                      </Text>
                    </View>
                    {sess.rsvped && sess.zoom_url ? (
                      <TouchableOpacity
                        style={[styles.sessionBtn, { backgroundColor: colors.green, borderColor: colors.green }]}
                        activeOpacity={0.8}
                        onPress={() => {
                          if (sess.kind === 'group') logFunnelEvent('attended', { source: 'support' });
                          Linking.openURL(sess.zoom_url!);
                        }}
                      >
                        <Text style={[styles.sessionBtnText, { color: '#fff' }]}>{t('sessions.joinZoom')}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[styles.sessionBtn, { backgroundColor: sess.rsvped ? colors.greenLight : colors.primaryLight, borderColor: sess.rsvped ? colors.green : colors.primary }]}
                      activeOpacity={0.8}
                      onPress={() => toggleRsvp(sess)}
                    >
                      <Text style={[styles.sessionBtnText, { color: sess.rsvped ? colors.green : colors.primary }]}>
                        {sess.rsvped ? t('sessions.confirmButton') : t('sessions.rsvpButton')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('paywall.eyebrow')}
              </Text>

              {/* Free row */}
              <View style={[styles.tierRow, { borderColor: colors.line, backgroundColor: colors.cream }]}>
                <View style={styles.tierInfo}>
                  <Text style={[styles.tierName, { color: colors.inkSoft }]}>{t('tier.freeName')}</Text>
                  <Text style={[styles.tierFeatures, { color: colors.inkSoft }]}>{t('tier.freeFeatures')}</Text>
                </View>
                <Text style={[styles.tierCurrent, { color: colors.inkSoft }]}>{t('tier.freeCurrent')}</Text>
              </View>

              {/* Essential row */}
              <View style={[styles.tierRow, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}>
                <View style={styles.tierInfo}>
                  <Text style={[styles.tierName, { color: colors.primary }]}>{t('tier.essentialName')}</Text>
                  <Text style={[styles.tierFeatures, { color: colors.inkSoft }]}>{t('tier.essentialFeatures')}</Text>
                </View>
                <Text style={[styles.tierPrice, { color: colors.primary }]}>{t('tier.essentialPrice')}</Text>
              </View>
              <TouchableOpacity
                style={[styles.solidBtn, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
                disabled={purchasing}
                onPress={() => void handlePurchaseEssential()}
              >
                <Text style={styles.solidBtnText}>
                  {purchasing ? '...' : t('paywall.subscribeEssential')}
                </Text>
              </TouchableOpacity>

              {/* Premium row */}
              <View style={[styles.tierRow, { borderColor: colors.line, backgroundColor: colors.white, marginTop: 12 }]}>
                <View style={styles.tierInfo}>
                  <Text style={[styles.tierName, { color: colors.ink }]}>{t('tier.premiumName')}</Text>
                  <Text style={[styles.tierFeatures, { color: colors.inkSoft }]}>{t('tier.premiumFeatures')}</Text>
                </View>
                <Text style={[styles.tierPrice, { color: colors.ink }]}>{t('tier.premiumPrice')}</Text>
              </View>
              <TouchableOpacity
                style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 8 }]}
                activeOpacity={0.85}
                disabled={purchasing}
                onPress={() => setUpgradeOpen(true)}
              >
                <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                  {t('paywall.subscribePremium')}
                </Text>
              </TouchableOpacity>

              {/* Auto-renewable subscription disclosure + legal links (App Store 3.1.2c) */}
              <Text style={[styles.disclosure, { color: colors.inkSoft }]}>
                {t('paywall.autoRenewDisclosure')}
              </Text>
              <View style={styles.legalRow}>
                <TouchableOpacity onPress={() => void Linking.openURL('https://soberhelpline.com/terms')}>
                  <Text style={[styles.legalLink, { color: colors.primary }]}>{t('upgradeSheet.termsOfUse')}</Text>
                </TouchableOpacity>
                <Text style={[styles.legalSep, { color: colors.inkSoft }]}> · </Text>
                <TouchableOpacity onPress={() => void Linking.openURL('https://soberhelpline.com/privacy')}>
                  <Text style={[styles.legalLink, { color: colors.primary }]}>{t('upgradeSheet.privacyPolicy')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* Essential / Premium: full content */}
        {!isAttached && accountState !== 'direct-free' && (
          <>
            {/* Tier card — hidden for premium (it moves to Settings) */}
            {accountState !== 'direct-premium' && (
              <View style={[styles.card, { borderColor: colors.line }]}>
                <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                  {t('tier.eyebrow')}
                </Text>

                <View style={[styles.tierRow, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}>
                  <View style={styles.tierInfo}>
                    <Text style={[styles.tierName, { color: colors.primary }]}>
                      {t('tier.essentialName')}
                    </Text>
                    <Text style={[styles.tierFeatures, { color: colors.inkSoft }]}>
                      {t('tier.essentialFeatures')}
                    </Text>
                  </View>
                  <View style={styles.tierRight}>
                    <Text style={[styles.tierPrice, { color: colors.primary }]}>
                      {t('tier.essentialPrice')}
                    </Text>
                    {accountState === 'direct-essential' && (
                      <Text style={[styles.tierCurrent, { color: colors.inkSoft }]}>
                        {t('tier.current')}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={[styles.tierRow, { borderColor: colors.line, backgroundColor: '#fff' }]}>
                  <View style={styles.tierInfo}>
                    <Text style={[styles.tierName, { color: colors.ink }]}>
                      {t('tier.premiumName')}
                    </Text>
                    <Text style={[styles.tierFeatures, { color: colors.inkSoft }]}>
                      {t('tier.premiumFeatures')}
                    </Text>
                  </View>
                  <View style={styles.tierRight}>
                    <Text style={[styles.tierPrice, { color: colors.ink }]}>
                      {t('tier.premiumPrice')}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.solidBtn, { backgroundColor: colors.primary }]}
                  activeOpacity={0.85}
                  onPress={() => setUpgradeOpen(true)}
                >
                  <Text style={styles.solidBtnText}>{t('tier.upgradeButton')}</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('messages.eyebrow')}
              </Text>
              <TouchableOpacity
                style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 0 }]}
                activeOpacity={0.8}
                onPress={() => router.push('/chat')}
              >
                <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                  {t('chat.openButton')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('coaching.eyebrow')}
              </Text>
              <Text style={[styles.referralTitle, { color: colors.ink }]}>
                {t('coaching.cardTitle')}
              </Text>
              <Text style={[styles.referralBody, { color: colors.inkSoft }]}>
                {t('coaching.cardBody')}
              </Text>
              <TouchableOpacity
                style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 12 }]}
                activeOpacity={0.8}
                onPress={() => router.push('/book-coaching')}
              >
                <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                  {t('coaching.cardButton')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('sessions.eyebrow')}
              </Text>
              {sessions.map((sess) => (
                <View key={sess.id} style={[styles.sessionOuter, { borderBottomColor: colors.line }]}>
                  <View style={styles.sessionRow}>
                    <View style={styles.sessionInfo}>
                      <Text style={[styles.sessionTitle, { color: colors.ink }]}>{sess.title}</Text>
                      <Text style={[styles.sessionMeta, { color: colors.inkSoft }]}>
                        {sessionTypeKey(sess.kind, t)} · {sess.schedule_label}
                      </Text>
                    </View>
                    {sess.rsvped && sess.zoom_url ? (
                      <TouchableOpacity
                        style={[styles.sessionBtn, { backgroundColor: colors.green, borderColor: colors.green }]}
                        activeOpacity={0.8}
                        onPress={() => {
                          if (sess.kind === 'group') logFunnelEvent('attended', { source: 'support' });
                          Linking.openURL(sess.zoom_url!);
                        }}
                      >
                        <Text style={[styles.sessionBtnText, { color: '#fff' }]}>{t('sessions.joinZoom')}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[styles.sessionBtn, { backgroundColor: sess.rsvped ? colors.greenLight : colors.primaryLight, borderColor: sess.rsvped ? colors.green : colors.primary }]}
                      activeOpacity={0.8}
                      onPress={() => toggleRsvp(sess)}
                    >
                      <Text style={[styles.sessionBtnText, { color: sess.rsvped ? colors.green : colors.primary }]}>
                        {sess.rsvped ? t('sessions.confirmButton') : t('sessions.rsvpButton')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {sess.rsvped && (
                    <TouchableOpacity
                      style={[styles.questionBtn, { borderColor: colors.primary }]}
                      activeOpacity={0.8}
                      onPress={() => setQuestionSession(sess)}
                    >
                      <Text style={[styles.questionBtnText, { color: colors.primary }]}>
                        {t('questionModal.button')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>

            <View style={[styles.card, { borderColor: colors.line }]}>
              <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                {t('referral.eyebrow')}
              </Text>
              <Text style={[styles.referralTitle, { color: colors.ink }]}>
                {t('referral.title')}
              </Text>
              <Text style={[styles.referralBody, { color: colors.inkSoft }]}>
                {t('referral.body')}
              </Text>
              <TouchableOpacity
                style={[styles.outlineBtn, { borderColor: colors.secondary, marginTop: 12 }]}
                activeOpacity={0.8}
                onPress={() => setProviderOpen(true)}
              >
                <Text style={[styles.outlineBtnText, { color: colors.secondary }]}>
                  {t('referral.button')}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Groups — both account types */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
            {t('groups.eyebrow')}
          </Text>
          {groups.map((group: SupportGroup) => {
            const room = group.liveRoomId;
            const isMyRoom = !!(room && myRooms.includes(room));
            const isLive = !!(room && liveRooms.includes(room));
            const isRsvped = !!(room && rsvpedRooms.has(room));
            return (
              <View
                key={group.id}
                style={[styles.groupRow, { borderBottomColor: colors.line }]}
              >
                <View style={[styles.groupIcon, { backgroundColor: group.accentColor }]}>
                  <Text style={styles.groupIconText}>{group.icon}</Text>
                </View>
                <View style={styles.groupInfo}>
                  <Text style={[styles.groupName, { color: colors.ink }]}>{group.name}</Text>
                  <Text style={[styles.groupMeta, { color: colors.inkSoft }]}>
                    {group.scheduleLabel}
                    {group.onlineCount > 0 ? `  ·  ${group.onlineCount} online` : ''}
                  </Text>
                  {!isMyRoom && room ? (
                    <TouchableOpacity
                      style={[
                        styles.rsvpInlineBtn,
                        {
                          borderColor: isRsvped ? colors.green : colors.primary,
                          backgroundColor: isRsvped ? colors.greenLight : 'transparent',
                        },
                      ]}
                      activeOpacity={0.7}
                      onPress={() => void toggleGroupRsvp(room)}
                    >
                      <Text style={[styles.rsvpInlineBtnText, { color: isRsvped ? colors.green : colors.primary }]}>
                        {isRsvped ? t('groups.rsvpDone') : t('groups.rsvpButton')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {/* Status button */}
                {isMyRoom ? (
                  <TouchableOpacity
                    style={[styles.joinBtn, { borderColor: colors.coral, backgroundColor: colors.coral }]}
                    activeOpacity={0.8}
                    onPress={() => router.push({ pathname: '/live-room' as never, params: { room } })}
                  >
                    <Text style={[styles.joinBtnText, { color: '#fff' }]}>{t('groups.goLive')}</Text>
                  </TouchableOpacity>
                ) : isLive ? (
                  <TouchableOpacity
                    style={[styles.joinBtn, { borderColor: colors.coral, backgroundColor: '#111111' }]}
                    activeOpacity={0.8}
                    onPress={() => router.push({ pathname: '/live-room' as never, params: { room } })}
                  >
                    <Text style={[styles.joinBtnText, { color: '#fff' }]}>{t('groups.joinLive')}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.joinBtn, { borderColor: colors.primary, backgroundColor: '#e0e0e0' }]}>
                    <Text style={[styles.joinBtnText, { color: '#aaaaaa' }]}>{t('groups.joinButton')}</Text>
                  </View>
                )}
              </View>
            );
          })}
          <TouchableOpacity
            style={[styles.communityRow, { borderColor: colors.line }]}
            activeOpacity={0.8}
            onPress={() => router.push('/community')}
          >
            <Text style={[styles.communityRowText, { color: colors.ink }]}>
              {t('community.openLink')}
            </Text>
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '700' }}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.moreGroupsRow}
            activeOpacity={0.7}
            onPress={() => Linking.openURL(GROUPS_URL)}
          >
            <Text style={[styles.moreGroupsText, { color: colors.inkSoft }]}>
              {t('groups.moreIntro')}{' '}
              <Text style={{ color: colors.primary, fontWeight: '700' }}>
                {t('groups.moreLink')}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>

        {/* Language selector */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
            {t('language.eyebrow')}
          </Text>
          <View style={styles.pillRow}>
            {languages.map((lang) => {
              const active = current === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.pill,
                    {
                      borderColor: active ? colors.primary : colors.line,
                      backgroundColor: active ? colors.primaryLight : '#fff',
                    },
                  ]}
                  onPress={() => change(lang.code)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: active ? colors.primary : colors.inkSoft },
                    ]}
                  >
                    {lang.nativeLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      {/* ── Question modal ── */}
      <Modal visible={questionSession !== null} animationType="slide" transparent onRequestClose={() => setQuestionSession(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.questionModalKAV}
        >
          <TouchableOpacity
            style={[StyleSheet.absoluteFill, styles.modalOverlay]}
            activeOpacity={1}
            onPress={() => setQuestionSession(null)}
          />
          <View style={[styles.questionSheet, { backgroundColor: colors.white, marginHorizontal: sheetOffset }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>{t('questionModal.title')}</Text>
            <Text style={[styles.sheetSub, { color: colors.inkSoft, marginBottom: 14 }]}>{t('questionModal.sub')}</Text>

            {questionSubmitted ? (
              <Text style={[styles.sheetTitle, { color: colors.green, fontSize: 16, textAlign: 'center', marginVertical: 24 }]}>
                {t('questionModal.submitted')}
              </Text>
            ) : (
              <>
                <TextInput
                  style={[styles.questionInput, { borderColor: colors.line, color: colors.ink }]}
                  placeholder={t('questionModal.placeholder')}
                  placeholderTextColor={colors.inkSoft}
                  value={questionText}
                  onChangeText={setQuestionText}
                  multiline
                  maxLength={500}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.solidBtn, { backgroundColor: questionText.trim() ? colors.primary : colors.line, marginTop: 12 }]}
                  disabled={!questionText.trim() || questionSubmitting}
                  onPress={submitQuestion}
                  activeOpacity={0.85}
                >
                  {questionSubmitting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.solidBtnText}>{t('questionModal.submit')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.sheetRow, styles.sheetRowLast, { marginTop: 4 }]} onPress={() => setQuestionSession(null)}>
                  <Text style={[styles.sheetRowName, { color: colors.inkSoft }]}>{t('questionModal.cancel')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  settingsIcon: { fontSize: 22 },

  sosButton: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 14,
  },
  sosText: { color: '#fff', fontSize: 16, fontWeight: '700' },

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
    marginBottom: 12,
  },

  staffChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  staffAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffInitials: { fontWeight: '700', fontSize: 14 },
  staffInfo: { flex: 1 },
  staffName: { fontSize: 14, fontWeight: '600' },
  staffRole: { fontSize: 12, marginTop: 1 },

  sessionOuter: {
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionInfo: { flex: 1 },
  sessionTitle: { fontSize: 14, fontWeight: '600' },
  sessionMeta: { fontSize: 12, marginTop: 2 },
  sessionBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  sessionBtnText: { fontSize: 12, fontWeight: '600' },
  questionBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  questionBtnText: { fontSize: 12, fontWeight: '600' },
  questionInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  questionModalKAV: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  questionSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 20,
  },

  tierRow: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  tierInfo: { flex: 1 },
  tierName: { fontSize: 14, fontWeight: '700' },
  tierFeatures: { fontSize: 12, marginTop: 2 },
  tierRight: { alignItems: 'flex-end' },
  tierPrice: { fontSize: 14, fontWeight: '700' },
  tierCurrent: { fontSize: 11, marginTop: 2 },


  membershipRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coveredChip: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  coveredText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  membershipSub: { fontSize: 12, flex: 1 },

  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  groupIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupIconText: { fontSize: 20 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 14, fontWeight: '600' },
  groupMeta: { fontSize: 12, marginTop: 2 },
  joinBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  joinBtnText: { fontSize: 12, fontWeight: '600' },
  rsvpInlineBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginTop: 6,
  },
  rsvpInlineBtnText: { fontSize: 11, fontWeight: '700' },
  moreGroupsRow: { paddingTop: 12, alignItems: 'center' },
  moreGroupsText: { fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 14,
  },
  communityRowText: { fontSize: 14, fontWeight: '700' },

  comingSoonText: { fontSize: 13, fontStyle: 'italic' },
  referralTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  referralBody: { fontSize: 13, lineHeight: 19 },

  solidBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  solidBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  outlineBtn: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  outlineBtnText: { fontWeight: '700', fontSize: 14 },

  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    borderWidth: 1.5,
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  pillText: { fontSize: 13, fontWeight: '600' },

  // Crisis sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  sheetSub: { fontSize: 14, marginBottom: 20 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetRowLast: { borderBottomWidth: 0 },
  offRampWrap: { marginTop: 14 },
  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 12, marginBottom: 4 },
  legalLink: { fontSize: 12, fontWeight: '500', textDecorationLine: 'underline' },
  legalSep: { fontSize: 12 },
  disclosure: { fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 14 },
  sheetRowName: { fontSize: 14, fontWeight: '600', flex: 1 },
  sheetRowSub: { fontSize: 12, marginTop: 2 },
  sheetRowAction: { fontSize: 14, fontWeight: '700' },
  sheetActionBtn: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  sheetActionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  dividerRow: {
    borderTopWidth: 1,
    paddingTop: 14,
    paddingBottom: 4,
  },
  dividerText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },

  // Crisis protocol card (trigger)
  protocolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 12,
    backgroundColor: '#fff',
  },
  protocolCardIcon: { fontSize: 22 },
  protocolCardBody: { flex: 1 },
  protocolCardEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  protocolCardTitle: { fontSize: 14, fontWeight: '700' },
  protocolCardSub: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  protocolCardArrow: { fontSize: 22, fontWeight: '300' },

  finderCard: { borderRadius: 16, padding: 18, marginBottom: 16 },
  finderTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  finderSub: { color: '#c9d6e6', fontSize: 13.5, lineHeight: 19 },

  // Crisis protocol sheet (modal)
  protocolTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  protocolTab: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  protocolTabText: { fontSize: 12, fontWeight: '700' },
  protocolSteps: { marginBottom: 8 },
  protocolSectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 14 },
  protocolStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  protocolStepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  protocolStepNumText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  protocolStepText: { flex: 1, fontSize: 14, lineHeight: 21 },
});
