import React, { useState } from 'react';
import { Platform, Share, Text, TouchableOpacity, View } from 'react-native';
import * as Print from 'expo-print';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { walletMembershipCopy } from '../../content/walletMembershipCopy';
import { selectedWalletText, walletPrintHtml, type WalletExportItem } from '../../lib/safetyWalletExport';
import { appAlert } from '../../lib/appAlert';
import { canOpenPrintWindow, printHtmlInNewWindow, shareOrCopy, webCanShare } from '../../lib/webShare';

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
  const web = Platform.OS === 'web';
  // On web, Print opens a window with only the preview; without one, hide it.
  const canPrint = !web || canOpenPrintWindow(globalThis);
  const button = (label: string, onPress: () => void, disabled = false) => <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ padding: 14, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, marginTop: 10, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text></TouchableOpacity>;
  async function exportPreview(print: boolean) {
    if (!preview || busy) return;
    if (print && web) {
      // expo-print on web ignores the html and prints this whole screen.
      // Synchronous so the browser treats the window as a response to the tap.
      if (printHtmlInNewWindow(globalThis, walletPrintHtml(preview)) !== 'printed') appAlert(t('wallet.printBlocked'));
      return;
    }
    setBusy(true);
    try {
      if (print) await Print.printAsync({ html: walletPrintHtml(preview) });
      else {
        const outcome = await shareOrCopy(preview, {
          canShare: !web || webCanShare(globalThis),
          share: (message) => Share.share({ message }),
          copy: (message) => Clipboard.setStringAsync(message),
        });
        if (outcome === 'copied') appAlert(t('wallet.copiedToClipboard'));
        else if (outcome === 'failed') appAlert(copy.error);
      }
    } catch { appAlert(copy.error); }
    finally { setBusy(false); }
  }
  return <View style={{ marginBottom: 14 }}>
    {!open ? button(label ?? copy.choose, () => { setSelected([]); setPreview(''); setOpen(true); }) : <>
      <Text style={{ color: colors.inkSoft, lineHeight: 21 }}>{copy.selection}</Text>
      {preview ? <>
        <Text accessibilityRole="header" style={{ color: colors.ink, fontWeight: '700', marginTop: 12 }}>{copy.preview}</Text>
        <Text selectable style={{ color: colors.ink, lineHeight: 23, marginTop: 12 }}>{preview}</Text>
        {button(copy.share, () => void exportPreview(false), busy)}
        {canPrint ? button(copy.print, () => void exportPreview(true), busy) : null}
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
