import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Linking,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { GROUPS_URL } from '../../src/config';
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
  t,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  isAttached: boolean;
  onMessage: () => void;
  t: (key: string) => string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
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
      <View style={[styles.sheet, { backgroundColor: colors.white }]}>
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
  const { user, isAttached, accountState } = useAccount();
  const { t } = useTranslation('support');
  const { current, change, languages } = useLanguage();
  const router = useRouter();

  const [crisisOpen, setCrisisOpen] = useState(false);

  const roster = getMockOnCallRoster(isAttached ? 'attached' : 'direct');
  const { sessions, toggleRsvp } = useSessions(user?.id ?? null);
  const groups = getMockSupportGroups();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <CrisisSheet
        visible={crisisOpen}
        onClose={() => setCrisisOpen(false)}
        isAttached={isAttached}
        onMessage={() => router.push('/chat')}
        t={t}
        colors={colors}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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
                <View
                  key={sess.id}
                  style={[styles.sessionRow, { borderBottomColor: colors.line }]}
                >
                  <View style={styles.sessionInfo}>
                    <Text style={[styles.sessionTitle, { color: colors.ink }]}>
                      {sess.title}
                    </Text>
                    <Text style={[styles.sessionMeta, { color: colors.inkSoft }]}>
                      {sessionTypeKey(sess.kind, t)} · {sess.schedule_label}
                    </Text>
                  </View>
                  {sess.rsvped && sess.zoom_url ? (
                    <TouchableOpacity
                      style={[
                        styles.sessionBtn,
                        { backgroundColor: colors.green, borderColor: colors.green },
                      ]}
                      activeOpacity={0.8}
                      onPress={() => Linking.openURL(sess.zoom_url!)}
                    >
                      <Text style={[styles.sessionBtnText, { color: '#fff' }]}>
                        {t('sessions.joinZoom')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[
                      styles.sessionBtn,
                      {
                        backgroundColor: sess.rsvped ? colors.greenLight : colors.primaryLight,
                        borderColor: sess.rsvped ? colors.green : colors.primary,
                      },
                    ]}
                    activeOpacity={0.8}
                    onPress={() => toggleRsvp(sess)}
                  >
                    <Text
                      style={[
                        styles.sessionBtnText,
                        { color: sess.rsvped ? colors.green : colors.primary },
                      ]}
                    >
                      {sess.rsvped ? t('sessions.confirmButton') : t('sessions.rsvpButton')}
                    </Text>
                  </TouchableOpacity>
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

        {/* Direct: tier card + messages + referral */}
        {!isAttached && (
          <>
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
                  {accountState === 'direct-premium' && (
                    <Text style={[styles.tierCurrent, { color: colors.inkSoft }]}>
                      {t('tier.current')}
                    </Text>
                  )}
                </View>
              </View>

              {accountState !== 'direct-premium' && (
                <TouchableOpacity
                  style={[styles.solidBtn, { backgroundColor: colors.primary }]}
                  activeOpacity={0.85}
                >
                  <Text style={styles.solidBtnText}>{t('tier.upgradeButton')}</Text>
                </TouchableOpacity>
              )}
            </View>

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
                <View
                  key={sess.id}
                  style={[styles.sessionRow, { borderBottomColor: colors.line }]}
                >
                  <View style={styles.sessionInfo}>
                    <Text style={[styles.sessionTitle, { color: colors.ink }]}>
                      {sess.title}
                    </Text>
                    <Text style={[styles.sessionMeta, { color: colors.inkSoft }]}>
                      {sessionTypeKey(sess.kind, t)} · {sess.schedule_label}
                    </Text>
                  </View>
                  {sess.rsvped && sess.zoom_url ? (
                    <TouchableOpacity
                      style={[
                        styles.sessionBtn,
                        { backgroundColor: colors.green, borderColor: colors.green },
                      ]}
                      activeOpacity={0.8}
                      onPress={() => Linking.openURL(sess.zoom_url!)}
                    >
                      <Text style={[styles.sessionBtnText, { color: '#fff' }]}>
                        {t('sessions.joinZoom')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[
                      styles.sessionBtn,
                      {
                        backgroundColor: sess.rsvped ? colors.greenLight : colors.primaryLight,
                        borderColor: sess.rsvped ? colors.green : colors.primary,
                      },
                    ]}
                    activeOpacity={0.8}
                    onPress={() => toggleRsvp(sess)}
                  >
                    <Text
                      style={[
                        styles.sessionBtnText,
                        { color: sess.rsvped ? colors.green : colors.primary },
                      ]}
                    >
                      {sess.rsvped ? t('sessions.confirmButton') : t('sessions.rsvpButton')}
                    </Text>
                  </TouchableOpacity>
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
          {groups.map((group: SupportGroup) => (
            <View
              key={group.id}
              style={[styles.groupRow, { borderBottomColor: colors.line }]}
            >
              <View
                style={[styles.groupIcon, { backgroundColor: group.accentColor }]}
              >
                <Text style={styles.groupIconText}>{group.icon}</Text>
              </View>
              <View style={styles.groupInfo}>
                <Text style={[styles.groupName, { color: colors.ink }]}>{group.name}</Text>
                <Text style={[styles.groupMeta, { color: colors.inkSoft }]}>
                  {group.scheduleLabel}
                  {group.onlineCount > 0
                    ? `  ·  ${group.onlineCount} online`
                    : ''}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.joinBtn, { borderColor: colors.primary }]}
                activeOpacity={0.8}
                onPress={() => Linking.openURL(group.joinUrl ?? GROUPS_URL)}
              >
                <Text style={[styles.joinBtnText, { color: colors.primary }]}>
                  {t('groups.joinButton')}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
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

  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
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
  moreGroupsRow: { paddingTop: 12, alignItems: 'center' },
  moreGroupsText: { fontSize: 12.5, lineHeight: 18, textAlign: 'center' },

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
});
