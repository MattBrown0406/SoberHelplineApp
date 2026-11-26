import React from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { FEATURED_PROVIDER } from '../../config';

/** "Find a provider" (members): the vetted interventionist's email and website. */
export function ProviderSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { width: screenWidth } = useWindowDimensions();
  const sheetOffset = Math.max(0, (screenWidth - 520) / 2);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common:a11y.close')} style={styles.modalOverlay} activeOpacity={1} onPress={onClose} />
      <ScrollView
        style={[styles.sheet, { backgroundColor: colors.white, left: sheetOffset, right: sheetOffset }]}
        contentContainerStyle={styles.sheetContent}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
        <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.ink }]}>
          {t('providerSheet.title')}
        </Text>

        <View style={[styles.sheetRow, { borderBottomColor: colors.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sheetRowTitle, { color: colors.ink }]}>
              {FEATURED_PROVIDER.name} · {FEATURED_PROVIDER.org}
            </Text>
            <Text style={[styles.sheetRowSub, { color: colors.inkSoft }]}>
              {t('providerSheet.credential', {
                credential: FEATURED_PROVIDER.credential,
                credentialFull: t('common:provider.credentialFull'),
              })}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel={t('providerSheet.emailButton', { name: FEATURED_PROVIDER.name })}
          style={[styles.sheetRow, { borderBottomColor: colors.line }]}
          onPress={() => void Linking.openURL(`mailto:${FEATURED_PROVIDER.email}`)}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>
            {t('providerSheet.emailButton', { name: FEATURED_PROVIDER.name })}
          </Text>
          <Text style={[styles.sheetRowAction, { color: colors.primary }]}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel={t('providerSheet.webButton')}
          style={[styles.sheetRow, styles.sheetRowLast, { borderBottomColor: colors.line }]}
          onPress={() => void Linking.openURL(FEATURED_PROVIDER.web)}
        >
          <Text style={[styles.sheetRowName, { color: colors.ink }]}>
            {t('providerSheet.webButton')}
          </Text>
          <Text style={[styles.sheetRowAction, { color: colors.primary }]}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button" style={[styles.sheetRow, styles.sheetRowLast]} onPress={onClose}>
          <Text style={[styles.sheetRowName, { color: colors.inkSoft }]}>
            {t('providerSheet.close')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
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
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetRowLast: { borderBottomWidth: 0 },
  sheetRowName: { fontSize: 14, fontWeight: '600', flex: 1 },
  sheetRowTitle: { fontSize: 14, fontWeight: '600' },
  sheetRowSub: { fontSize: 12, marginTop: 2 },
  sheetRowAction: { fontSize: 14, fontWeight: '700' },
});
