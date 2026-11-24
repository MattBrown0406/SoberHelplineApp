import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { buttonShape } from '../ui/Button';
import { PRIMARY_ON_CALL } from '../../content/onCall';
import { openEmergencyLink } from '../../lib/emergencyLinks';
import type { FunnelDoor } from '../../lib/situation';
import { SituationOffRamp } from '../situation/SituationOffRamp';

// Sober Helpline's phone line (direct dial). (503) 836-2136 is the WhatsApp
// chat line only — never dial it from here.
const CRISIS_LINE_TEL = 'tel:+14582988008';
const CRISIS_LINE_DISPLAY = '(458) 298-8008';

type CrisisTab = 'overdose' | 'selfHarm' | 'unsafe';

/**
 * The step-by-step crisis guide (overdose, self-harm, unsafe behaviour). It
 * opens inside the crisis sheet, under 911 and 988, so the Support tab has
 * one way in to crisis help instead of two.
 */
function CrisisGuide() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
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
    <View style={styles.guide}>
      <View style={[styles.protocolTabBar, { borderBottomColor: colors.line }]}>
        {tabs.map((tb) => (
          <TouchableOpacity
            key={tb.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === tb.key }}
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

      <View style={styles.protocolSteps}>
        <Text accessibilityRole="header" style={[styles.protocolSectionTitle, { color: colors.ink }]}>{section}</Text>
        {steps.map((step, i) => (
          <View key={i} style={styles.protocolStep}>
            <View style={[styles.protocolStepNum, { backgroundColor: colors.primary }]}>
              <Text style={styles.protocolStepNumText}>{i + 1}</Text>
            </View>
            <Text style={[styles.protocolStepText, { color: colors.ink }]}>{step}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Crisis help, opened by the one crisis row on the Support tab: Crisis
 * Copilot, the on-call coach, 911 and 988, the crisis guide, then the
 * helpline (family guidance, in its own group below the emergency lines).
 */
export function CrisisSheet({
  visible,
  onClose,
  isAttached,
  canMessage,
  onMessage,
  onCopilot,
  door,
}: {
  visible: boolean;
  onClose: () => void;
  isAttached: boolean;
  canMessage: boolean;
  onMessage: () => void;
  onCopilot: () => void;
  door: FunnelDoor;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { width: screenWidth } = useWindowDimensions();
  const sheetOffset = Math.max(0, (screenWidth - 520) / 2);
  const primary = PRIMARY_ON_CALL;
  const [guideOpen, setGuideOpen] = useState(false);
  // Every time the sheet opens it starts with the emergency lines in view.
  useEffect(() => {
    if (!visible) setGuideOpen(false);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('common:a11y.close')}
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      />
      <ScrollView
        style={[styles.sheet, { backgroundColor: colors.white, left: sheetOffset, right: sheetOffset }]}
        contentContainerStyle={styles.sheetContent}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />

        <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.ink }]}>
          {t('crisis.sheetTitle')}
        </Text>
        <Text style={[styles.sheetSub, { color: colors.inkSoft }]}>
          {primary.firstName} {isAttached ? t('crisis.attachedSub') : canMessage ? t('crisis.directSub') : t('crisis.freeSub')}
        </Text>

        <View style={[styles.copilotCard, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <View style={styles.copilotCopy}>
            <Text style={[styles.copilotTitle, { color: colors.ink }]}>{t('crisis.copilotTitle')}</Text>
            <Text style={[styles.copilotBody, { color: colors.inkSoft }]}>{t('crisis.copilotBody')}</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.copilotButton, { backgroundColor: colors.primary }]}
            onPress={() => { onClose(); onCopilot(); }}
          >
            <Text style={styles.copilotButtonText}>{t('crisis.copilotButton')}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.sheetRow, { borderBottomColor: colors.line }]}>
          <View style={styles.sheetRowCopy}>
            <Text style={[styles.sheetRowTitle, { color: colors.ink }]}>
              {primary.firstName} {primary.lastName}
            </Text>
            <Text style={[styles.sheetRowSub, { color: colors.inkSoft }]}>
              {primary.credentialDisplay ? `${primary.roleLabel} · ${primary.credentialDisplay}` : primary.roleLabel}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.sheetActionBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
            onPress={() => {
              if (isAttached) {
                openEmergencyLink(CRISIS_LINE_TEL, CRISIS_LINE_DISPLAY);
              } else if (canMessage) {
                onClose();
                onMessage();
              } else {
                onClose();
                onCopilot();
              }
            }}
          >
            <Text style={styles.sheetActionBtnText}>
              {isAttached ? t('crisis.callButton') : canMessage ? t('crisis.messageButton') : t('crisis.copilotButton')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.dividerRow, { borderTopColor: colors.line }]}>
          <Text style={[styles.dividerText, { color: colors.inkSoft }]}>
            {t('crisis.divider')}
          </Text>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.sheetRow, styles.sheetRowLast, { borderBottomColor: colors.line }]}
          onPress={() => openEmergencyLink('tel:911')}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>{t('crisis.line911')}</Text>
          <Text style={[styles.sheetRowAction, { color: colors.coral }]}>{t('crisis.callButton')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.sheetRow, styles.sheetRowLast]}
          onPress={() => openEmergencyLink('tel:988')}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>{t('crisis.line988')}</Text>
          <Text style={[styles.sheetRowAction, { color: colors.primary }]}>{t('crisis.callButton')}</Text>
        </TouchableOpacity>

        {/* The crisis guide (it had its own card on the tab): what to do,
            step by step, right under the numbers to call. */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${t('crisisProtocol.heading')}. ${t('crisisProtocol.sub')}`}
          accessibilityState={{ expanded: guideOpen }}
          aria-expanded={guideOpen}
          style={[styles.sheetRow, styles.sheetRowLast, styles.guideRow, { borderTopColor: colors.line }]}
          onPress={() => setGuideOpen((value) => !value)}
          activeOpacity={0.8}
        >
          <View style={styles.sheetRowCopy}>
            <Text style={[styles.sheetRowTitle, { color: colors.ink }]}>{t('crisisProtocol.heading')}</Text>
            <Text style={[styles.sheetRowSub, { color: colors.inkSoft }]}>{t('crisisProtocol.sub')}</Text>
          </View>
          <MaterialCommunityIcons
            name={guideOpen ? 'chevron-up' : 'chevron-down'}
            size={24}
            color={colors.primary}
            accessible={false}
            importantForAccessibility="no"
          />
        </TouchableOpacity>
        {guideOpen && <CrisisGuide />}

        {/* Sober Helpline is family guidance, not an emergency service and not
            staffed around the clock, so it sits in its own group below 911/988. */}
        <View style={[styles.dividerRow, { borderTopColor: colors.line }]}>
          <Text style={[styles.dividerText, { color: colors.inkSoft }]}>
            {t('crisis.guidanceDivider')}
          </Text>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.sheetRow, styles.sheetRowLast]}
          onPress={() => openEmergencyLink(CRISIS_LINE_TEL, CRISIS_LINE_DISPLAY)}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>{t('crisis.lineSh')}</Text>
          <Text style={[styles.sheetRowAction, { color: colors.primary }]}>{t('crisis.callButton')}</Text>
        </TouchableOpacity>

        {/* Situation-aware next step — only for an escalated band, and only for
            self-guided members (attached families already have a provider).
            Always below the safety lines and never in their place. */}
        {door !== 'free_call' && !isAttached && (
          <View style={styles.offRampWrap}>
            <SituationOffRamp door={door} onBeforeNavigate={onClose} compact hidePrice />
          </View>
        )}

        {/* (It stood under the crisis button on the tab.) */}
        <Text style={[styles.freeNote, { color: colors.inkSoft }]}>{t('crisis.freeNote')}</Text>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  // Scrolls: at large accessibility text sizes the content is taller than
  // the screen, and its top (title, coach buttons) must stay reachable.
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetContent: { padding: 24, paddingBottom: 40 },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  sheetSub: { fontSize: 14, marginBottom: 20 },
  copilotCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 10 },
  copilotCopy: { marginBottom: 10 },
  copilotTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  copilotBody: { fontSize: 13, lineHeight: 18 },
  copilotButton: { ...buttonShape, paddingVertical: 11 },
  copilotButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetRowLast: { borderBottomWidth: 0 },
  sheetRowCopy: { flex: 1 },
  guideRow: { borderTopWidth: 1 },
  offRampWrap: { marginTop: 14 },
  sheetRowName: { fontSize: 14, fontWeight: '600', flex: 1 },
  sheetRowTitle: { fontSize: 14, fontWeight: '600' },
  sheetRowSub: { fontSize: 12, marginTop: 2 },
  sheetRowAction: { fontSize: 14, fontWeight: '700' },
  sheetActionBtn: { minHeight: 44, justifyContent: 'center',
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
  freeNote: { fontSize: 12.5, lineHeight: 18, marginTop: 18 },

  // Crisis guide
  guide: { paddingTop: 4, paddingBottom: 4 },
  protocolTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  protocolTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 44,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  protocolTabText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
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
