import { useToolOpened } from '../src/hooks/useToolOpened';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useProsecutorLetter } from '../src/hooks/useProsecutorLetter';
import { appAlert } from '../src/lib/appAlert';
import { logToolUsage } from '../src/lib/toolUsage';
import { shareOrCopy, webCanShare } from '../src/lib/webShare';
import { isSessionOnlyPlanStorage } from '../src/lib/webSessionPlanStore';
import {
  PROSECUTOR_INPUT_MAX_LENGTH,
  PROSECUTOR_LETTER_LANGUAGES,
  PROSECUTOR_TEXT_KEYS,
  prosecutorLetterProgress,
  prosecutorLetterText,
  type ProsecutorTextKey,
} from '../src/lib/prosecutorLetter';

export default function ProsecutorLetterScreen() {
  useToolOpened('prosecutor_letter');
  const router = useRouter();
  const { t } = useTranslation('prosecutorLetter');
  const { colors } = useTheme();
  const { user } = useAccount();
  const { plan: letter, loadState, saveState, update, reload, retrySave, clear } = useProsecutorLetter(user?.id ?? null);
  const progress = useMemo(() => prosecutorLetterProgress(letter), [letter]);
  const before = t('before', { returnObjects: true }) as string[];

  // The letter itself is in the language she picks for it, whatever the app's
  // language: prosecutors' offices usually work in English.
  const letterText = useMemo(() => {
    const fixed = i18n.getFixedT(letter.letterLanguage, 'prosecutorLetter');
    const date = new Intl.DateTimeFormat(letter.letterLanguage === 'es' ? 'es' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date());
    return prosecutorLetterText(letter, (key, options) => fixed(key, options), date);
  }, [letter]);

  // Finished when she fills in the last required detail during this visit.
  const sawIncomplete = useRef(false);
  useEffect(() => {
    if (loadState !== 'ready') return;
    if (!progress.ready) {
      sawIncomplete.current = true;
      return;
    }
    if (saveState !== 'saved' || !sawIncomplete.current) return;
    sawIncomplete.current = false;
    logToolUsage('prosecutor_letter', 'finished');
  }, [loadState, progress.ready, saveState]);

  const confirmClear = () => appAlert(t('clearTitle'), t('clearBody'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('clearConfirm'), style: 'destructive', onPress: () => void clear().catch(() => undefined) },
  ]);

  async function shareLetter() {
    const outcome = await shareOrCopy(letterText, {
      canShare: Platform.OS !== 'web' || webCanShare(globalThis),
      share: (message) => Share.share({ message, title: t('title') }),
      copy: (message) => Clipboard.setStringAsync(message),
    });
    if (outcome === 'copied') appAlert(t('shareCopied'));
    else if (outcome === 'failed') appAlert(t('shareError'));
  }

  const field = (key: ProsecutorTextKey) => (
    <View key={key} style={styles.fieldWrap}>
      <Text style={[styles.label, { color: colors.ink }]}>{t(`fields.${key}`)}</Text>
      <TextInput
        accessibilityLabel={t(`fields.${key}`)}
        value={letter[key]}
        onChangeText={(value) => update({ [key]: value })}
        placeholder={t(`fields.${key}Placeholder`)}
        placeholderTextColor={colors.inkSoft}
        maxLength={PROSECUTOR_INPUT_MAX_LENGTH}
        autoCapitalize={key === 'contact' ? 'none' : 'sentences'}
        style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.white }]}
      />
    </View>
  );

  return (
    <ScreenContainer scroll contentContainerStyle={styles.screen}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => router.back()}>
        <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
      </TouchableOpacity>
      <Text style={[styles.kicker, { color: colors.coral }]}>{t('kicker')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
      <Text style={[styles.intro, { color: colors.inkSoft }]}>{t('intro')}</Text>
      <Text style={[styles.privacy, { color: colors.primary }]}>{t('privacy')}</Text>
      {isSessionOnlyPlanStorage(Platform.OS) ? (
        <Text style={[styles.privacy, { color: colors.inkSoft }]}>{t('webSessionNotice')}</Text>
      ) : null}

      <View style={[styles.beforeCard, { backgroundColor: colors.primaryDark }]}>
        <Text accessibilityRole="header" style={styles.beforeTitle}>{t('beforeTitle')}</Text>
        {before.map((item, index) => (
          <View key={index} style={styles.beforeRow}>
            <Text style={styles.beforeNumber}>{index + 1}</Text>
            <Text style={styles.beforeText}>{item}</Text>
          </View>
        ))}
        <Text style={styles.legalNote}>{t('legalNote')}</Text>
      </View>

      {loadState === 'loading' ? (
        <View style={[styles.stateCard, { borderColor: colors.line, backgroundColor: colors.white }]}>
          <ActivityIndicator accessibilityRole="progressbar" color={colors.primary} />
          <Text style={[styles.stateText, { color: colors.ink }]}>{t('loading')}</Text>
        </View>
      ) : loadState === 'error' ? (
        <View accessibilityRole="alert" style={[styles.stateCard, { borderColor: colors.coral, backgroundColor: colors.coralLight }]}>
          <Text style={[styles.stateTitle, { color: colors.coral }]}>{t('loadErrorTitle')}</Text>
          <Text style={[styles.stateBody, { color: colors.ink }]}>{t('loadErrorBody')}</Text>
          <ActionButton label={t('retry')} onPress={() => void reload()} />
          <ActionButton label={t('startOver')} destructive onPress={confirmClear} />
        </View>
      ) : (
        <>
          <View style={[styles.section, { borderColor: colors.line, backgroundColor: colors.white }]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>{t('sectionDetails')}</Text>
            <Text style={[styles.sectionHint, { color: colors.inkSoft }]}>{t('detailsHint')}</Text>
            {PROSECUTOR_TEXT_KEYS.map(field)}
            <Text style={[styles.count, { color: colors.ink }]}>{t('progressCount', { completed: progress.completed, total: progress.total })}</Text>
            <Text accessibilityRole={saveState === 'error' ? 'alert' : 'text'} style={[styles.saveText, { color: saveState === 'error' ? colors.coral : colors.inkSoft }]}>
              {saveState === 'saving' ? t('saveSaving') : saveState === 'error' ? t('saveError') : t('saveSaved')}
            </Text>
            {saveState === 'error' && <ActionButton label={t('retrySave')} onPress={retrySave} />}
          </View>

          <Text style={[styles.label, { color: colors.ink }]}>{t('languageLabel')}</Text>
          <Text style={[styles.sectionHint, { color: colors.inkSoft }]}>{t('languageHint')}</Text>
          <View accessibilityRole="radiogroup" style={styles.choices}>
            {PROSECUTOR_LETTER_LANGUAGES.map((language) => {
              const selected = letter.letterLanguage === language;
              return (
                <TouchableOpacity
                  key={language}
                  accessibilityRole="radio"
                  accessibilityLabel={t(`languages.${language}`)}
                  accessibilityState={{ checked: selected }}
                  onPress={() => update({ letterLanguage: language })}
                  activeOpacity={0.8}
                  style={[styles.choice, { borderColor: selected ? colors.primary : colors.line, backgroundColor: selected ? colors.primary : colors.white }]}
                >
                  <Text style={[styles.choiceText, { color: selected ? '#fff' : colors.ink }]}>{t(`languages.${language}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.previewCard, { borderColor: colors.line, backgroundColor: colors.white }]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>{t('previewTitle')}</Text>
            <Text selectable style={[styles.letterText, { color: colors.ink }]}>{letterText}</Text>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('share')}
            accessibilityHint={t('shareNote')}
            onPress={() => void shareLetter()}
            activeOpacity={0.85}
            style={[styles.shareButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.shareButtonText}>{t('share')}</Text>
          </TouchableOpacity>
          <Text style={[styles.shareNote, { color: colors.inkSoft }]}>{t('shareNote')}</Text>

          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('startOver')} onPress={confirmClear} style={styles.clearButton}>
            <Text style={[styles.clearText, { color: colors.coral }]}>{t('startOver')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScreenContainer>
  );
}

function ActionButton({ label, onPress, destructive = false }: { label: string; onPress: () => void; destructive?: boolean }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.actionButton, { backgroundColor: destructive ? colors.coral : colors.primary }]}>
      <Text style={styles.actionButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 48 },
  back: { fontSize: 15, fontWeight: '700', marginBottom: 20 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginBottom: 7 },
  title: { fontSize: 29, lineHeight: 34, fontWeight: '900', marginBottom: 10 },
  intro: { fontSize: 16, lineHeight: 23, marginBottom: 8 },
  privacy: { fontSize: 12.5, lineHeight: 18, fontWeight: '700', marginBottom: 18 },
  beforeCard: { borderRadius: 16, padding: 20, marginBottom: 18 },
  beforeTitle: { color: '#fff', fontSize: 19, fontWeight: '900', marginBottom: 12 },
  beforeRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  beforeNumber: { color: '#fff', fontSize: 15, fontWeight: '900', width: 18 },
  beforeText: { flex: 1, color: '#d9e3ed', fontSize: 14, lineHeight: 21 },
  legalNote: { color: '#d9e3ed', fontSize: 12.5, lineHeight: 18, fontStyle: 'italic', marginTop: 4 },
  stateCard: { borderWidth: 1, borderRadius: 14, padding: 20, gap: 12, marginBottom: 18 },
  stateText: { fontSize: 15, textAlign: 'center' },
  stateTitle: { fontSize: 18, fontWeight: '800' },
  stateBody: { fontSize: 14, lineHeight: 21 },
  section: { borderWidth: 1, borderRadius: 14, padding: 18, marginBottom: 18 },
  sectionTitle: { fontSize: 19, fontWeight: '900', marginBottom: 4 },
  sectionHint: { fontSize: 13, lineHeight: 18, marginBottom: 14 },
  fieldWrap: { marginBottom: 14 },
  label: { fontSize: 13.5, lineHeight: 18, fontWeight: '800', marginBottom: 7 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  count: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  saveText: { fontSize: 12.5, fontWeight: '700', marginTop: 6 },
  choices: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  choice: { borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  choiceText: { fontSize: 15, fontWeight: '700' },
  previewCard: { borderWidth: 1, borderRadius: 14, padding: 18, marginBottom: 16 },
  letterText: { fontSize: 14.5, lineHeight: 22, marginTop: 8 },
  shareButton: { borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  shareButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  shareNote: { fontSize: 12.5, lineHeight: 18, marginTop: 8, marginBottom: 18 },
  clearButton: { alignSelf: 'center', padding: 14, marginTop: 10 },
  clearText: { fontSize: 14, fontWeight: '800' },
  actionButton: { alignSelf: 'flex-start', borderRadius: 9, paddingHorizontal: 15, paddingVertical: 10, marginTop: 2 },
  actionButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
