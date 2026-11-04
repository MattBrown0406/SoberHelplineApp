import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useLovedOne } from '../../hooks/useLovedOne';
import { appAlert } from '../../lib/appAlert';
import { isBereaved } from '../../lib/bereavement';
import { BereavementSheet } from './BereavementSheet';

/** Settings: tell us your loved one died, or undo it if it was a mistake. */
export function BereavementSettingsCard({ accountId }: { accountId: string | null }) {
  const { colors } = useTheme();
  const { t } = useTranslation('settings');
  const { lovedOne, loading, loadError, markDied, clearDied } = useLovedOne(accountId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);

  if (!accountId || loading || loadError) return null;
  const bereaved = isBereaved(lovedOne);

  const undo = () => appAlert(t('bereavement.undoTitle'), t('bereavement.undoBody'), [
    { text: t('bereavement.undoCancel'), style: 'cancel' },
    {
      text: t('bereavement.undoConfirm'),
      onPress: () => {
        setUndoing(true);
        void clearDied()
          .catch(() => appAlert(t('bereavement.errorTitle'), t('bereavement.errorBody')))
          .finally(() => setUndoing(false));
      },
    },
  ]);

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>{t('bereavement.eyebrow')}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t(bereaved ? 'bereavement.bereavedBody' : 'bereavement.body')}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t(bereaved ? 'bereavement.undo' : 'bereavement.tell')}
        disabled={undoing}
        onPress={bereaved ? undo : () => setSheetOpen(true)}
        style={[styles.button, { borderColor: colors.line }]}
      >
        {undoing ? <ActivityIndicator color={colors.primary} /> : (
          <Text style={[styles.buttonText, { color: colors.primary }]}>{t(bereaved ? 'bereavement.undo' : 'bereavement.tell')}</Text>
        )}
      </TouchableOpacity>
      <BereavementSheet
        visible={sheetOpen}
        onCancel={() => setSheetOpen(false)}
        onConfirm={async (contact) => {
          await markDied(contact);
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 16 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  button: { borderWidth: 1, borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
