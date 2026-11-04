import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useLovedOne } from '../../hooks/useLovedOne';
import { rearmDailyNudge } from '../../hooks/usePushNotifications';
import { appAlert } from '../../lib/appAlert';
import { isBereaved } from '../../lib/bereavement';
import { BereavementSheet } from './BereavementSheet';

/** Settings: tell us your loved one died, or undo it if it was a mistake. */
export function BereavementSettingsCard({ accountId }: { accountId: string | null }) {
  const { colors } = useTheme();
  const { t } = useTranslation('settings');
  const { lovedOne, loading, loadError, markDied, clearDied, setQuiet } = useLovedOne(accountId);
  const [quietBusy, setQuietBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);

  if (!accountId || loading || loadError) return null;
  const bereaved = isBereaved(lovedOne);
  const quiet = lovedOne?.bereavement_quiet === true;
  // The device's own reminders follow every change.
  const syncDevice = () => { void rearmDailyNudge().catch(() => undefined); };

  const toggleReminders = (remindersOn: boolean) => {
    setQuietBusy(true);
    void setQuiet(!remindersOn)
      .then(syncDevice)
      .catch(() => appAlert(t('bereavement.errorTitle'), t('bereavement.errorBody')))
      .finally(() => setQuietBusy(false));
  };

  const undo = () => appAlert(t('bereavement.undoTitle'), t('bereavement.undoBody'), [
    { text: t('bereavement.undoCancel'), style: 'cancel' },
    {
      text: t('bereavement.undoConfirm'),
      onPress: () => {
        setUndoing(true);
        void clearDied()
          .then(syncDevice)
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
      {bereaved ? (
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={[styles.switchLabel, { color: colors.ink }]}>{t('bereavement.remindersLabel')}</Text>
            <Text style={[styles.switchDesc, { color: colors.inkSoft }]}>{t('bereavement.remindersDesc')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('bereavement.remindersLabel')}
            accessibilityHint={t('bereavement.remindersDesc')}
            value={!quiet}
            disabled={quietBusy}
            onValueChange={toggleReminders}
          />
        </View>
      ) : null}
      <BereavementSheet
        visible={sheetOpen}
        onCancel={() => setSheetOpen(false)}
        onConfirm={async (contact, quietChoice) => {
          const { quietFailed } = await markDied(contact, quietChoice);
          if (quietFailed) appAlert(t('bereavement.errorTitle'), t('bereavement.quietFailed'));
          syncDevice();
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, minHeight: 44 },
  switchText: { flex: 1 },
  switchLabel: { fontSize: 14, fontWeight: '600' },
  switchDesc: { fontSize: 12, lineHeight: 17, marginTop: 3 },
});
