import React, { useState } from 'react';
import { Alert, Share, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { SafetyPlan } from '../../lib/safetyWallet';
import {
  availableEmergencyCardSections,
  familyEmergencyCardText,
  type EmergencyCardSection,
} from '../../lib/familyEmergencyCard';

// Remount the selection whenever the plan, account or locale changes so a
// stale preview can never be shared.
export function FamilyEmergencyCard({ plan, scope = '' }: { plan: SafetyPlan; scope?: string }) {
  const { i18n } = useTranslation('crisis');
  return <CardSession key={JSON.stringify([scope, i18n.language, plan])} plan={plan} />;
}

function CardSession({ plan }: { plan: SafetyPlan }) {
  const { t } = useTranslation('crisis');
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<EmergencyCardSection[]>([]);
  const [preview, setPreview] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const available = availableEmergencyCardSections(plan);
  const crisisLines = t('wallet.familyCard.crisisLines', { returnObjects: true });
  const text = familyEmergencyCardText(plan, selected, {
    title: t('wallet.familyCard.title'),
    section: (section) => t(`wallet.familyCard.sections.${section}`),
    field: (field) => t(`wallet.fields.${field}`),
    crisisHeading: t('wallet.familyCard.crisisHeading'),
    crisisLines: Array.isArray(crisisLines) ? crisisLines.map(String) : [],
    note: t('wallet.familyCard.note'),
  });
  const button = (label: string, onPress: () => void, disabled = false, primary = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={{ padding: 14, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, marginTop: 10, opacity: disabled ? 0.5 : 1, backgroundColor: primary ? colors.primary : 'transparent' }}>
      <Text style={{ color: primary ? '#fff' : colors.primary, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
  async function share() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await Share.share({ message: preview, title: t('wallet.familyCard.title') });
    } catch {
      Alert.alert(t('wallet.familyCard.shareError'));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await Clipboard.setStringAsync(preview);
      setCopied(true);
    } catch {
      Alert.alert(t('wallet.familyCard.shareError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ marginBottom: 14 }}>
      {!open ? button(t('wallet.familyCard.button'), () => { setSelected([]); setPreview(''); setCopied(false); setOpen(true); }, false, true) : (
        <>
          <Text style={{ color: colors.inkSoft, lineHeight: 21 }}>{t('wallet.familyCard.intro')}</Text>
          {preview ? (
            <>
              <Text accessibilityRole="header" style={{ color: colors.ink, fontWeight: '700', marginTop: 12 }}>{t('wallet.familyCard.preview')}</Text>
              <Text selectable style={{ color: colors.ink, lineHeight: 23, marginTop: 12 }}>{preview}</Text>
              {button(t('wallet.familyCard.share'), () => void share(), busy, true)}
              {button(copied ? t('wallet.familyCard.copied') : t('wallet.familyCard.copy'), () => void copy(), busy)}
              {button(t('wallet.familyCard.back'), () => { setPreview(''); setCopied(false); }, busy)}
            </>
          ) : (
            <>
              {!available.length && <Text style={{ color: colors.inkSoft, marginTop: 12 }}>{t('wallet.familyCard.empty')}</Text>}
              {available.map((section) => {
                const checked = selected.includes(section);
                return (
                  <TouchableOpacity key={section} accessibilityRole="checkbox" accessibilityState={{ checked }} aria-checked={checked}
                    onPress={() => setSelected((current) => checked ? current.filter((id) => id !== section) : [...current, section])}
                    style={{ paddingVertical: 12 }}>
                    <Text style={{ color: colors.ink }}>{checked ? '☑' : '☐'} {t(`wallet.familyCard.sections.${section}`)}</Text>
                  </TouchableOpacity>
                );
              })}
              {button(t('wallet.familyCard.preview'), () => setPreview(text), !text)}
            </>
          )}
          {button(t('wallet.familyCard.close'), () => { setOpen(false); setPreview(''); setSelected([]); setCopied(false); }, busy)}
        </>
      )}
    </View>
  );
}
