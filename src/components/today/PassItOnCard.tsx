import React, { useState } from 'react';
import { Platform, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Print from 'expo-print';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { logFunnelEvent } from '../../lib/funnel';
import {
  boundaryCardHtml,
  isResourceActionCancellation,
  mondayCallShareMessage,
  resourceLanguage,
} from '../../lib/passItOnResources';

type Action = 'share' | 'print' | null;

/**
 * A privacy-safe distribution surface. It shares only public recovery resources;
 * no account, check-in, loved-one, or family data is included.
 */
export function PassItOnCard() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('today');
  const [activeAction, setActiveAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const language = resourceLanguage(i18n.language);
  const disabled = activeAction !== null;

  async function shareMondayCall(): Promise<void> {
    if (disabled) return;
    setActiveAction('share');
    setError(null);
    setNotice(null);
    try {
      const message = mondayCallShareMessage(language);
      logFunnelEvent('monday_call_share_requested', { language });
      if (Platform.OS === 'web') {
        if (navigator.share) {
          await navigator.share({ title: t('passItOn.shareTitle'), text: message });
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(message);
          setNotice(t('passItOn.copied'));
        } else {
          throw new Error('web_share_unavailable');
        }
      } else {
        await Share.share({ title: t('passItOn.shareTitle'), message });
      }
    } catch (actionError) {
      if (!isResourceActionCancellation(actionError)) setError(t('passItOn.shareError'));
    } finally {
      setActiveAction(null);
    }
  }

  async function printBoundaryCard(): Promise<void> {
    if (disabled) return;
    setActiveAction('print');
    setError(null);
    setNotice(null);
    try {
      const html = boundaryCardHtml(language);
      logFunnelEvent('boundary_card_print_requested', { language });
      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (!printWindow) throw new Error('print_window_blocked');
        printWindow.opener = null;
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      } else {
        await Print.printAsync({ html });
      }
    } catch (actionError) {
      if (!isResourceActionCancellation(actionError)) setError(t('passItOn.printError'));
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('passItOn.eyebrow').toUpperCase()}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('passItOn.title')}
      </Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t('passItOn.body')}</Text>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: activeAction === 'share' }}
        accessibilityLabel={t('passItOn.shareButton')}
        style={[styles.primaryButton, { backgroundColor: colors.primary }, disabled && styles.disabled]}
        onPress={() => void shareMondayCall()}
        disabled={disabled}
        activeOpacity={0.84}
      >
        <Text style={styles.primaryButtonText}>
          {activeAction === 'share' ? t('passItOn.sharing') : t('passItOn.shareButton')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: activeAction === 'print' }}
        accessibilityLabel={t('passItOn.printButton')}
        style={[styles.secondaryButton, { borderColor: colors.primary }, disabled && styles.disabled]}
        onPress={() => void printBoundaryCard()}
        disabled={disabled}
        activeOpacity={0.84}
      >
        <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
          {activeAction === 'print' ? t('passItOn.printing') : t('passItOn.printButton')}
        </Text>
      </TouchableOpacity>

      <Text style={[styles.privacy, { color: colors.inkSoft }]}>{t('passItOn.privacy')}</Text>
      {activeAction && (
        <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.inkSoft }]}>
          {activeAction === 'share' ? t('passItOn.sharing') : t('passItOn.printing')}
        </Text>
      )}
      {notice && (
        <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.green }]}>
          {notice}
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: colors.coral }]}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 7,
  },
  title: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    marginBottom: 7,
  },
  body: {
    fontSize: 14.5,
    lineHeight: 21,
    marginBottom: 16,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  privacy: {
    marginTop: 12,
    fontSize: 11.5,
    lineHeight: 16,
  },
  status: {
    marginTop: 9,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  error: {
    marginTop: 9,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  disabled: { opacity: 0.55 },
});
