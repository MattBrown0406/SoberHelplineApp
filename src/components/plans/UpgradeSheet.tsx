import React from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../../config';
import type { SubscriptionTier } from '../../hooks/useIAP';
import { BenefitList } from './BenefitList';

/**
 * The purchase sheet for one plan. The price, the trial and the renewal terms
 * all come from StoreKit (never hard-coded copy); without a store price the
 * sheet says the price is unavailable and the button stays disabled.
 */
export function UpgradeSheet({
  visible,
  tier,
  price,
  trial,
  onClose,
  onPurchase,
  purchasing,
}: {
  visible: boolean;
  tier: SubscriptionTier;
  /** The store's price string, or undefined while it has not loaded. */
  price: string | undefined;
  /** "7-day free trial" when the store will give her one; price stays the headline. */
  trial: string | null;
  onClose: () => void;
  onPurchase: () => void;
  purchasing: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { t: tPlans } = useTranslation('plans');
  const { width: screenWidth } = useWindowDimensions();
  const sheetOffset = Math.max(0, (screenWidth - 520) / 2);
  const priceAvailable = !!price;
  const priceLabel = price ?? tPlans('priceUnavailable');
  const plan = tier === 'premium' ? 'premier' : 'essential';
  const buyLabel = purchasing ? '...' : priceAvailable
    ? trial
      ? t('paywall.startTrial', { trial, price: priceLabel })
      : t(tier === 'essential' ? 'paywall.subscribeEssential' : 'paywall.subscribePremium', { price: priceLabel })
    : priceLabel;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={tPlans('choose.closeLabel')}
      />
      <ScrollView
        style={[styles.sheet, { backgroundColor: colors.white, left: sheetOffset, right: sheetOffset }]}
        contentContainerStyle={styles.sheetContent}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
        <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.ink }]}>
          {t(`tier.${tier}Name`)}
        </Text>
        <Text style={[styles.tierPrice, { color: colors.ink, marginBottom: trial && priceAvailable ? 4 : 12 }]}>
          {priceAvailable ? tPlans('perMonth', { price: priceLabel }) : priceLabel}
        </Text>
        {trial && priceAvailable && (
          <Text style={[styles.sheetSub, { color: colors.primary, marginBottom: 12 }]}>
            {t('paywall.trialThen', { trial, price: priceLabel })}
          </Text>
        )}

        {/* The one benefits list (plans.json), most valued first. */}
        <Text style={[styles.sheetSub, { color: colors.inkSoft, marginBottom: 0 }]}>
          {tPlans(`headings.${plan}`)}
        </Text>
        <BenefitList plan={plan} />

        {priceAvailable ? (
          <Text style={[styles.sheetSub, { color: colors.inkSoft, marginTop: 12, marginBottom: 16 }]}>
            {trial
              ? t('upgradeSheet.trialRenewalNote', { trial, price: priceLabel })
              : t('upgradeSheet.renewalNote', { price: priceLabel })}
          </Text>
        ) : <View style={{ height: 16 }} />}

        <TouchableOpacity
          style={[
            styles.solidBtn,
            { backgroundColor: purchasing || !priceAvailable ? colors.inkSoft : colors.primary },
          ]}
          activeOpacity={0.85}
          disabled={purchasing || !priceAvailable}
          accessibilityRole="button"
          accessibilityLabel={buyLabel}
          accessibilityState={{ disabled: purchasing || !priceAvailable, busy: purchasing }}
          onPress={onPurchase}
        >
          <Text style={styles.solidBtnText}>{buyLabel}</Text>
        </TouchableOpacity>

        <View style={styles.legalRow}>
          <TouchableOpacity
            style={styles.legalBtn}
            accessibilityRole="link"
            accessibilityLabel={tPlans('choose.privacyLabel')}
            onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          >
            <Text style={[styles.legalLink, { color: colors.primary }]}>{t('upgradeSheet.privacyPolicy')}</Text>
          </TouchableOpacity>
          <Text style={[styles.legalSep, { color: colors.inkSoft }]}> · </Text>
          <TouchableOpacity
            style={styles.legalBtn}
            accessibilityRole="link"
            accessibilityLabel={tPlans('choose.termsLabel')}
            onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}
          >
            <Text style={[styles.legalLink, { color: colors.primary }]}>{t('upgradeSheet.termsOfUse')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.closeRow}
          accessibilityRole="button"
          accessibilityLabel={t('upgradeSheet.close')}
          onPress={onClose}
        >
          <Text style={[styles.closeText, { color: colors.inkSoft }]}>
            {t('upgradeSheet.close')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  // Scrolls: at large accessibility text sizes the content is taller than
  // the screen, and its top must stay reachable.
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
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  sheetSub: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  tierPrice: { fontSize: 14, fontWeight: '700' },
  solidBtn: {
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  solidBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 12, marginBottom: 4 },
  legalBtn: { minHeight: 44, justifyContent: 'center' },
  legalLink: { fontSize: 12, fontWeight: '500', textDecorationLine: 'underline' },
  legalSep: { fontSize: 12 },
  closeRow: { minHeight: 44, justifyContent: 'center', paddingVertical: 14, marginTop: 4 },
  closeText: { fontSize: 14, fontWeight: '600' },
});
