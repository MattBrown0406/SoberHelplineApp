import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  visible: boolean;
  onCancel: () => void;
  /** `contact`: she agreed to let Matt know so someone can reach out. */
  onConfirm: (contact: boolean) => Promise<unknown>;
}

/** The gentle confirmation before the app treats her loved one as having died. */
export function BereavementSheet({ visible, onCancel, onConfirm }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const [contact, setContact] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setContact(true);
    setSaving(false);
    setError(false);
  }, [visible]);

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await onConfirm(contact);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={saving ? undefined : onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.white }]} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('bereavement.sheet.title')}</Text>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('bereavement.sheet.body')}</Text>
            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityState={{ checked: contact, disabled: saving }}
              accessibilityLabel={t('bereavement.sheet.contact')}
              disabled={saving}
              onPress={() => setContact((value) => !value)}
              activeOpacity={0.8}
              style={[styles.checkRow, { borderColor: contact ? colors.primary : colors.line }]}
            >
              <View style={[styles.checkbox, { borderColor: contact ? colors.primary : colors.inkSoft, backgroundColor: contact ? colors.primary : colors.white }]}>
                {contact && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.checkLabel, { color: colors.ink }]}>{t('bereavement.sheet.contact')}</Text>
            </TouchableOpacity>
            {error && <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('bereavement.sheet.error')}</Text>}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('bereavement.sheet.confirm')}
              disabled={saving}
              onPress={() => void confirm()}
              activeOpacity={0.85}
              style={[styles.confirm, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{t('bereavement.sheet.confirm')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={onCancel} style={styles.cancel}>
              <Text style={[styles.cancelText, { color: colors.inkSoft }]}>{t('bereavement.sheet.cancel')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' },
  content: { padding: 22, paddingBottom: 36 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderRadius: 12, padding: 13, minHeight: 44, marginBottom: 14 },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkmark: { color: '#fff', fontSize: 15, fontWeight: '900' },
  checkLabel: { flex: 1, fontSize: 14.5, lineHeight: 21, fontWeight: '600' },
  error: { fontSize: 13.5, fontWeight: '700', marginBottom: 10 },
  confirm: { borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cancel: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, marginTop: 6 },
  cancelText: { fontSize: 15, fontWeight: '700' },
});
