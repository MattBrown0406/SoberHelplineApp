import React, { useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { appAlert } from '../../lib/appAlert';
import { GRIEF_RESOURCES } from '../../lib/bereavement';
import { openEmergencyLink } from '../../lib/emergencyLinks';
import { text988Url } from '../safety/text988Url';

interface Props {
  /** Reminders and notes are paused. */
  quiet?: boolean;
  /** Pause or bring back every reminder and note. Omitted: no link. */
  onSetQuiet?: (quiet: boolean) => Promise<unknown>;
}

/** Today after her loved one died: one card in place of everything about them. */
export function GriefCard({ quiet = false, onSetQuiet }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('today');
  const [changing, setChanging] = useState(false);
  const [quietError, setQuietError] = useState(false);

  const toggleQuiet = async () => {
    if (!onSetQuiet || changing) return;
    setChanging(true);
    setQuietError(false);
    try {
      await onSetQuiet(!quiet);
    } catch {
      setQuietError(true);
    } finally {
      setChanging(false);
    }
  };
  const paragraphs = t('bereavement.grief.paragraphs', { returnObjects: true }) as string[];

  const open = (url: string, site: string) => {
    void Linking.openURL(url).catch(() => appAlert(t('bereavement.grief.openError', { site })));
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('bereavement.grief.eyebrow')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('bereavement.grief.title')}</Text>
      {paragraphs.map((paragraph, index) => (
        <Text key={index} style={[styles.body, { color: colors.ink }]}>{paragraph}</Text>
      ))}

      {GRIEF_RESOURCES.map((resource) => (
        <View key={resource.key} style={[styles.resource, { borderColor: colors.line }]}>
          <Text style={[styles.resourceTitle, { color: colors.ink }]}>{t(`bereavement.grief.${resource.key}.title`)}</Text>
          <Text style={[styles.resourceBody, { color: colors.inkSoft }]}>{t(`bereavement.grief.${resource.key}.body`)}</Text>
          <TouchableOpacity
            accessibilityRole="link"
            accessibilityLabel={t(`bereavement.grief.${resource.key}.button`)}
            onPress={() => open(resource.url, resource.site)}
            style={[styles.linkButton, { borderColor: colors.primary }]}
          >
            <Text style={[styles.linkText, { color: colors.primary }]}>{t(`bereavement.grief.${resource.key}.button`)}</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={[styles.crisis, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
        <Text style={[styles.resourceTitle, { color: colors.ink }]}>{t('bereavement.grief.crisisTitle')}</Text>
        <Text style={[styles.resourceBody, { color: colors.ink }]}>{t('bereavement.grief.crisisBody')}</Text>
        <View style={styles.crisisButtons}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('crisis:emergency.call988')}
            onPress={() => openEmergencyLink('tel:988')}
            style={[styles.crisisButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.crisisButtonText}>{t('crisis:emergency.call988')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('crisis:emergency.text988')}
            onPress={() => openEmergencyLink(text988Url(i18n.language, Platform.OS), '988')}
            style={[styles.crisisButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.crisisButtonText}>{t('crisis:emergency.text988')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={[styles.stillHere, { color: colors.inkSoft }]}>{t('bereavement.grief.stillHere')}</Text>

      {onSetQuiet ? (
        <View style={styles.quietRow}>
          {quiet ? <Text style={[styles.quietNote, { color: colors.inkSoft }]}>{t('bereavement.grief.pausedNote')}</Text> : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t(quiet ? 'bereavement.grief.resume' : 'bereavement.grief.pause')}
            accessibilityState={{ busy: changing }}
            disabled={changing}
            onPress={() => void toggleQuiet()}
            style={styles.quietLink}
          >
            {changing ? <ActivityIndicator color={colors.primary} /> : (
              <Text style={[styles.quietLinkText, { color: colors.primary }]}>{t(quiet ? 'bereavement.grief.resume' : 'bereavement.grief.pause')}</Text>
            )}
          </TouchableOpacity>
          {quietError ? <Text accessibilityRole="alert" style={[styles.quietNote, { color: colors.coral }]}>{t('bereavement.grief.quietError')}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 16 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '800', marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 10 },
  resource: { borderTopWidth: 1, paddingTop: 12, marginTop: 4, marginBottom: 10 },
  resourceTitle: { fontSize: 15, fontWeight: '800', marginBottom: 4 },
  resourceBody: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  linkButton: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' },
  linkText: { fontSize: 14, fontWeight: '800' },
  crisis: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 6, marginBottom: 12 },
  crisisButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  crisisButton: { borderRadius: 10, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  crisisButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  stillHere: { fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  quietRow: { marginTop: 10, alignItems: 'center' },
  quietNote: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  quietLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  quietLinkText: { fontSize: 13.5, fontWeight: '700', textDecorationLine: 'underline' },
});
