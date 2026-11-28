import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { buttonShape } from '../ui/Button';
import { EmergencyActions } from '../safety/EmergencyActions';

/**
 * "Ask a question" for the Monday call. What is sent, and what the server's
 * crisis screen answered, is the Support tab's (support.tsx): this is the
 * sheet. `questionCrisis` 'sent': the question reads like an emergency, so
 * 911/988 stay on screen until she closes it. 'unsent': it could not be sent;
 * her words are kept for a retry, with 911/988 on screen.
 */
export function QuestionSheet({
  visible,
  readAnonymously,
  onReadAnonymouslyChange,  questionText,
  onChangeText,
  questionSubmitting,
  questionSubmitted,
  questionCrisis,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  readAnonymously: boolean;
  onReadAnonymouslyChange: (value: boolean) => void;
  questionText: string;
  onChangeText: (text: string) => void;
  questionSubmitting: boolean;
  questionSubmitted: boolean;
  questionCrisis: 'sent' | 'unsent' | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { width: screenWidth } = useWindowDimensions();
  const sheetOffset = Math.max(0, (screenWidth - 520) / 2);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.questionModalKAV}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('common:a11y.close')}
          style={[StyleSheet.absoluteFill, styles.modalOverlay]}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.questionSheet, { backgroundColor: colors.white, marginHorizontal: sheetOffset }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
          <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.ink }]}>{t('questionModal.title')}</Text>
          <Text style={[styles.sheetSub, { color: colors.inkSoft, marginBottom: 14 }]}>{t('questionModal.sub')}</Text>

          {questionCrisis ? (
            <ScrollView style={styles.questionCrisisScroll} contentContainerStyle={{ paddingBottom: 8 }}>
              <Text accessibilityRole="alert" style={[styles.sheetSub, { color: colors.ink, marginBottom: 12 }]}>
                {t(questionCrisis === 'sent' ? 'questionModal.crisisNote' : 'questionModal.crisisNotSent')}
              </Text>
              <EmergencyActions prominent offline={questionCrisis === 'unsent'} />
              {questionCrisis === 'unsent' && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('questionModal.retry')}
                  accessibilityState={{ disabled: questionSubmitting, busy: questionSubmitting }}
                  style={[styles.solidBtn, { backgroundColor: colors.primary, marginTop: 12 }]}
                  disabled={questionSubmitting}
                  onPress={onSubmit}
                  activeOpacity={0.85}
                >
                  {questionSubmitting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.solidBtnText}>{t('questionModal.retry')}</Text>}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                accessibilityRole="button"
                style={[questionCrisis === 'sent' ? styles.solidBtn : styles.sheetRow, questionCrisis === 'sent' ? { backgroundColor: colors.primary, marginTop: 12 } : styles.sheetRowLast]}
                onPress={onClose}
                activeOpacity={0.85}
              >
                <Text style={questionCrisis === 'sent' ? styles.solidBtnText : [styles.sheetRowName, { color: colors.inkSoft }]}>
                  {t(questionCrisis === 'sent' ? 'questionModal.done' : 'questionModal.cancel')}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          ) : questionSubmitted ? (
            <View><Text accessibilityLiveRegion="polite" style={[styles.sheetTitle, { color: colors.green, fontSize: 16, textAlign: 'center', marginVertical: 24 }]}>
              {t('questionModal.submitted')}
            </Text><TouchableOpacity accessibilityRole="button" onPress={onClose} style={[styles.solidBtn, { backgroundColor: colors.primary }]}><Text style={styles.solidBtnText}>{t('questionModal.done')}</Text></TouchableOpacity></View>
          ) : (
            <>
              <TextInput
                style={[styles.questionInput, { borderColor: colors.line, color: colors.ink }]}
                placeholder={t('questionModal.placeholder')}
                placeholderTextColor={colors.inkSoft}
                value={questionText}
                onChangeText={onChangeText}
                editable={!questionSubmitting}
                multiline
                maxLength={500}
                autoFocus
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                <Text style={[styles.sheetSub, { color: colors.ink, flex: 1, marginBottom: 0 }]}>{t('questionModal.anonymous')}</Text>
                <Switch accessibilityLabel={t('questionModal.anonymous')} value={readAnonymously} onValueChange={onReadAnonymouslyChange} disabled={questionSubmitting} />
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('questionModal.submit')}
                accessibilityState={{ disabled: !questionText.trim() || questionSubmitting, busy: questionSubmitting }}
                style={[styles.solidBtn, { backgroundColor: questionText.trim() ? colors.primary : colors.line, marginTop: 12 }]}
                disabled={!questionText.trim() || questionSubmitting}
                onPress={onSubmit}
                activeOpacity={0.85}
              >
                {questionSubmitting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.solidBtnText}>{t('questionModal.submit')}</Text>}
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[styles.sheetRow, styles.sheetRowLast, { marginTop: 4 }]} onPress={onClose}>
                <Text style={[styles.sheetRowName, { color: colors.inkSoft }]}>{t('questionModal.cancel')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  questionModalKAV: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  questionSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 20,
  },
  questionCrisisScroll: { maxHeight: 460 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  sheetSub: { fontSize: 14, marginBottom: 20 },
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
  questionInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  solidBtn: {
    ...buttonShape,
    paddingVertical: 12,
    marginTop: 4,
  },
  solidBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
});
