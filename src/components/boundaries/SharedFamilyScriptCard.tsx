import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { ScriptCard } from '../scripts/ScriptCard';
import { sharedFamilyScript } from '../../content/familyScripts';

export function SharedFamilyScriptCard({ wallText }: { wallText: string }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('alignment');
  const script = sharedFamilyScript(wallText, i18n.language);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>{t('sharedScript.eyebrow')}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t('sharedScript.body')}</Text>
      <ScriptCard script={script} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 4 },
  body: { fontSize: 12.5, lineHeight: 18, marginBottom: 8 },
});
