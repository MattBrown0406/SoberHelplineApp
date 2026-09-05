import React, { useState } from 'react';
import { Alert, Share, Text, TouchableOpacity, View } from 'react-native';
import * as Print from 'expo-print';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { walletMembershipCopy } from '../../content/walletMembershipCopy';
import { selectedWalletText, walletPrintHtml, type WalletExportItem } from '../../lib/safetyWalletExport';

// Remount the entire disclosure session on edits, clear, locale or account changes.
export function SafetyWalletExport({ items, scope = '', label }: { items: WalletExportItem[]; scope?: string; label?: string }) {
  const { i18n } = useTranslation('crisis');
  return <WalletExportSession key={JSON.stringify([scope, i18n.language, items])} items={items} label={label} />;
}

function WalletExportSession({ items, label }: { items: WalletExportItem[]; label?: string }) {
  const { i18n, t } = useTranslation('crisis');
  const copy = walletMembershipCopy(i18n.language);
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const text = selectedWalletText(items, selected, t('wallet.shareHeading'), copy.note);
  const button = (label: string, onPress: () => void, disabled = false) => <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ padding: 14, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, marginTop: 10, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text></TouchableOpacity>;
  async function exportPreview(print: boolean) {
    if (!preview || busy) return;
    setBusy(true);
    try {
      if (print) await Print.printAsync({ html: walletPrintHtml(preview) });
      else await Share.share({ message: preview });
    } catch { Alert.alert(copy.error); }
    finally { setBusy(false); }
  }
  return <View style={{ marginBottom: 14 }}>
    {!open ? button(label ?? copy.choose, () => { setSelected([]); setPreview(''); setOpen(true); }) : <>
      <Text style={{ color: colors.inkSoft, lineHeight: 21 }}>{copy.selection}</Text>
      {preview ? <>
        <Text accessibilityRole="header" style={{ color: colors.ink, fontWeight: '700', marginTop: 12 }}>{copy.preview}</Text>
        <Text selectable style={{ color: colors.ink, lineHeight: 23, marginTop: 12 }}>{preview}</Text>
        {button(copy.share, () => void exportPreview(false), busy)}
        {button(copy.print, () => void exportPreview(true), busy)}
        {button(copy.back, () => setPreview(''), busy)}
      </> : <>
        {items.map((item) => <TouchableOpacity key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(item.id) }} aria-checked={selected.includes(item.id)} onPress={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} style={{ paddingVertical: 12 }}>
          <Text style={{ color: colors.ink }}>{selected.includes(item.id) ? '☑' : '☐'} {item.label}</Text>
        </TouchableOpacity>)}
        {button(copy.preview, () => setPreview(text), !text)}
      </>}
      {button(copy.close, () => { setOpen(false); setPreview(''); setSelected([]); }, busy)}
    </>}
  </View>;
}
