import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
} from 'react-native';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useLanguage } from '../src/hooks/useLanguage';
import { supabase } from '../src/lib/supabase';
import { restorePurchases } from '../src/lib/revenueCat';

const CONSENT_SHARE_CHECKINS = '2';
const CONSENT_VERSION = '1.0';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const { user, isAttached, accountState, refreshAccount } = useAccount();
  const { t } = useTranslation('settings');
  const { current, change, languages } = useLanguage();
  const router = useRouter();

  const [shareCheckIns, setShareCheckIns] = useState(false);
  const [consentLoading, setConsentLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('consents')
      .select('granted_at, revoked_at')
      .eq('account_id', user.id)
      .eq('consent_key', CONSENT_SHARE_CHECKINS)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setShareCheckIns(!!data.granted_at && !data.revoked_at);
        }
        setConsentLoading(false);
      });
  }, [user?.id]);

  async function handleShareCheckInsToggle(value: boolean) {
    if (!user) return;
    setShareCheckIns(value);
    if (value) {
      await supabase.from('consents').upsert(
        {
          account_id: user.id,
          consent_key: CONSENT_SHARE_CHECKINS,
          version: CONSENT_VERSION,
          granted_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: 'account_id,consent_key' },
      );
    } else {
      await supabase
        .from('consents')
        .update({ revoked_at: new Date().toISOString() })
        .eq('account_id', user.id)
        .eq('consent_key', CONSENT_SHARE_CHECKINS);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const hasEntitlement = await restorePurchases();
      await refreshAccount();
      Alert.alert(
        hasEntitlement ? t('membership.restoreSuccessTitle') : t('membership.restoreNoneTitle'),
        hasEntitlement ? t('membership.restoreSuccessBody') : t('membership.restoreNoneBody'),
      );
    } catch {
      Alert.alert(t('membership.restoreErrorTitle'), t('membership.restoreErrorBody'));
    } finally {
      setRestoring(false);
    }
  }

  function handleDeleteAccount() {
    Alert.alert(
      t('deleteAccount.confirmTitle'),
      t('deleteAccount.confirmMessage'),
      [
        { text: t('deleteAccount.cancelButton'), style: 'cancel' },
        {
          text: t('deleteAccount.confirmButton'),
          style: 'destructive',
          onPress: async () => {
            await supabase.rpc('delete_own_account');
            await supabase.auth.signOut();
          },
        },
      ],
    );
  }

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '—';

  return (
    <ScreenContainer backgroundColor={colors.cream}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={[styles.backChevron, { color: colors.primary }]}>‹</Text>
          </TouchableOpacity>
          <Text style={[styles.heading, { color: colors.ink }]}>{t('title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Account */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
            {t('account.eyebrow')}
          </Text>
          <Row label={t('account.nameLabel')} value={fullName} colors={colors} />
          <Row label={t('account.emailLabel')} value={user?.email ?? '—'} colors={colors} last />
        </View>

        {/* Privacy — only meaningful for attached accounts with a coach */}
        {isAttached && (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
              {t('privacy.eyebrow')}
            </Text>
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextWrap}>
                <Text style={[styles.toggleLabel, { color: colors.ink }]}>
                  {t('privacy.shareCheckIns')}
                </Text>
                <Text style={[styles.toggleDesc, { color: colors.inkSoft }]}>
                  {t('privacy.shareCheckInsDesc')}
                </Text>
              </View>
              <Switch
                value={shareCheckIns}
                onValueChange={handleShareCheckInsToggle}
                disabled={consentLoading}
                trackColor={{ false: colors.line, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>
        )}

        {/* Subscription — for direct (non-org) accounts. Restore Purchases must
            stay reachable even when no subscription is currently detected. */}
        {!isAttached && (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
              {t('membership.eyebrow')}
            </Text>

            {accountState !== 'direct-free' && (
              <>
                <Text style={[styles.infoValue, { color: colors.ink, fontSize: 16, fontWeight: '700', marginBottom: 2 }]}>
                  {accountState === 'direct-premium'
                    ? t('membership.premiumPlan')
                    : t('membership.essentialPlan')}
                </Text>
                <Text style={[styles.infoLabel, { color: colors.inkSoft, marginBottom: 12 }]}>
                  {accountState === 'direct-premium'
                    ? t('membership.premiumFeatures')
                    : t('membership.essentialFeatures')}
                </Text>
                <TouchableOpacity
                  onPress={() => void Linking.openURL('https://apps.apple.com/account/subscriptions')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.manageLink, { color: colors.primary }]}>
                    {t('membership.manage')}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={[
                styles.restoreBtn,
                {
                  borderColor: colors.line,
                  marginTop: accountState !== 'direct-free' ? 14 : 0,
                },
              ]}
              onPress={handleRestore}
              disabled={restoring}
              activeOpacity={0.8}
            >
              {restoring ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={[styles.restoreText, { color: colors.primary }]}>
                  {t('membership.restore')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Language */}
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

        {/* Sign out */}
        <TouchableOpacity
          style={[styles.signOutBtn, { borderColor: colors.line }]}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text style={[styles.signOutText, { color: colors.ink }]}>{t('signOut')}</Text>
        </TouchableOpacity>

        {/* Delete account */}
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDeleteAccount}
          activeOpacity={0.8}
        >
          <Text style={[styles.deleteText, { color: colors.coral }]}>
            {t('deleteAccount.button')}
          </Text>
        </TouchableOpacity>
    </ScreenContainer>
  );
}

function Row({
  label,
  value,
  colors,
  last,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last ? null : { borderBottomColor: colors.line, borderBottomWidth: 1 }]}>
      <Text style={[styles.infoLabel, { color: colors.inkSoft }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  backChevron: { fontSize: 32, lineHeight: 36, fontWeight: '300', marginRight: 8 },
  heading: { fontSize: 20, fontWeight: '700', flex: 1 },
  headerSpacer: { width: 32 },

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

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14, fontWeight: '500' },
  manageLink: { fontSize: 14, fontWeight: '600' },
  restoreBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  restoreText: { fontSize: 14, fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  toggleTextWrap: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: '600' },
  toggleDesc: { fontSize: 12, marginTop: 3, lineHeight: 17 },

  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    borderWidth: 1.5,
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  pillText: { fontSize: 13, fontWeight: '600' },

  signOutBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  signOutText: { fontSize: 15, fontWeight: '600' },

  deleteBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteText: { fontSize: 14, fontWeight: '500' },
});
