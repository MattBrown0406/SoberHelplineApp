import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Share,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useBoundaries } from '../src/hooks/useBoundaries';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';
import type { LetterDraft, ExperienceBlock } from '../src/api/types';

// ── Tone flag detection ───────────────────────────────────────────────────────

const EN_FLAGS = ['you always', 'you never', 'after everything', 'how could you'];
const ES_FLAGS = ['tú siempre', 'tú nunca', 'después de todo', 'cómo pudiste'];

function hasToneFlag(text: string, lang: string): boolean {
  const t = text.toLowerCase();
  const flags = lang.startsWith('es') ? ES_FLAGS : EN_FLAGS;
  return flags.some((f) => t.includes(f));
}

// ── Brevity helpers ───────────────────────────────────────────────────────────

const PAGE_CHAR_LIMIT = 1500;
const CHARS_PER_MIN = 715;

function assembleLetterText(draft: LetterDraft): string {
  const blocks = draft.p2Experiences
    .filter((e) => e.when.trim() || e.felt.trim())
    .map((e) => `${e.when.trim()} ${e.felt.trim()}`.trim())
    .join(' ');

  return [
    draft.p1Body,
    `${draft.p2OpenerLabel} ${blocks}`,
    draft.p3Request,
    draft.p3Hope,
    draft.p3HealthySupport,
    draft.p3ClosingQuestion,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function pageFillPct(draft: LetterDraft): number {
  return Math.round((assembleLetterText(draft).length / PAGE_CHAR_LIMIT) * 100);
}

function readMinutes(draft: LetterDraft): number {
  return Math.max(1, Math.ceil(assembleLetterText(draft).length / CHARS_PER_MIN));
}

// ── Draft persistence ─────────────────────────────────────────────────────────

function draftKey(accountId: string, recipientName: string): string {
  return `@sh:letter:${accountId}:${recipientName.toLowerCase().trim()}`;
}

const DEFAULTS = {
  p2OpenerLabel: '',   // filled from locale in component
  p3Request: '',
  p3ClosingQuestion: '',
};

function emptyDraft(recipientName: string): LetterDraft {
  return {
    recipientName,
    p1Body: '',
    p2OpenerLabel: DEFAULTS.p2OpenerLabel,
    p2Experiences: [{ when: '', felt: '' }],
    p3Request: DEFAULTS.p3Request,
    p3Hope: '',
    p3HealthySupport: '',
    p3ConfirmedBoundaryIds: [],
    p3ClosingQuestion: DEFAULTS.p3ClosingQuestion,
    status: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

type Step = 'recipient' | 'p1' | 'p2' | 'p3' | 'preview';
const STEPS: Step[] = ['p1', 'p2', 'p3', 'preview'];

// ── Step indicator ────────────────────────────────────────────────────────────

function StepDot({ active, done, colors }: { active: boolean; done: boolean; colors: any }) {
  return (
    <View
      style={[
        styles.stepDot,
        {
          backgroundColor: done
            ? colors.green
            : active
            ? colors.primary
            : colors.line,
        },
      ]}
    />
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LetterScreen() {
  const { colors } = useTheme();
  const { user, isAttached } = useAccount();
  const { t, i18n } = useTranslation('letter');
  const router = useRouter();
  const { walls } = useBoundaries(user?.id ?? null);

  const [step, setStep] = useState<Step>('recipient');
  const [recipientName, setRecipientName] = useState('');
  const [draft, setDraft] = useState<LetterDraft | null>(null);
  const [saving, setSaving] = useState(false);

  // Load defaults from locale
  useEffect(() => {
    DEFAULTS.p2OpenerLabel = t('defaults.openerLabel');
    DEFAULTS.p3Request = t('defaults.request');
    DEFAULTS.p3ClosingQuestion = t('defaults.closing');
  }, [i18n.language]);

  async function loadOrCreateDraft(name: string) {
    if (!user) return;
    const key = draftKey(user.id, name);
    try {
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        setDraft(JSON.parse(stored));
      } else {
        const d = emptyDraft(name);
        d.p2OpenerLabel = t('defaults.openerLabel');
        d.p3Request = t('defaults.request');
        d.p3ClosingQuestion = t('defaults.closing');
        setDraft(d);
      }
    } catch {
      const d = emptyDraft(name);
      d.p2OpenerLabel = t('defaults.openerLabel');
      d.p3Request = t('defaults.request');
      d.p3ClosingQuestion = t('defaults.closing');
      setDraft(d);
    }
    setStep('p1');
  }

  const updateDraft = useCallback(
    async (patch: Partial<LetterDraft>) => {
      if (!draft || !user) return;
      const updated: LetterDraft = { ...draft, ...patch, updatedAt: new Date().toISOString() };
      setDraft(updated);
      setSaving(true);
      const key = draftKey(user.id, updated.recipientName);
      await AsyncStorage.setItem(key, JSON.stringify(updated));
      setSaving(false);
    },
    [draft, user],
  );

  function updateExperience(idx: number, field: keyof ExperienceBlock, value: string) {
    if (!draft) return;
    const exps = [...draft.p2Experiences];
    exps[idx] = { ...exps[idx], [field]: value };
    updateDraft({ p2Experiences: exps });
  }

  function addExperience() {
    if (!draft || draft.p2Experiences.length >= 3) return;
    updateDraft({ p2Experiences: [...draft.p2Experiences, { when: '', felt: '' }] });
  }

  function toggleBoundary(wallId: string) {
    if (!draft) return;
    const ids = draft.p3ConfirmedBoundaryIds.includes(wallId)
      ? draft.p3ConfirmedBoundaryIds.filter((id) => id !== wallId)
      : [...draft.p3ConfirmedBoundaryIds, wallId];
    updateDraft({ p3ConfirmedBoundaryIds: ids });
  }

  async function shareExport() {
    if (!draft) return;
    const letter = assembleLetterText(draft);
    await Share.share({ message: letter, title: `Letter for ${draft.recipientName}` });
  }

  const fill = draft ? pageFillPct(draft) : 0;
  const fillColor = fill <= 85 ? colors.green : fill <= 100 ? colors.secondary : colors.coral;
  const stepIndex = STEPS.indexOf(step);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      {/* Recipient entry */}
      {step === 'recipient' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={12}>
            <Text style={[styles.backChevron, { color: colors.primary }]}>‹</Text>
          </TouchableOpacity>

          <Text style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
          <Text style={[styles.entryBody, { color: colors.inkSoft }]}>{t('entryBody')}</Text>

          <Text style={[styles.label, { color: colors.ink }]}>{t('recipientLabel')}</Text>
          <TextInput
            style={[styles.textInput, { borderColor: colors.line, color: colors.ink }]}
            placeholder={t('recipientPlaceholder')}
            placeholderTextColor={colors.inkSoft}
            value={recipientName}
            onChangeText={setRecipientName}
            autoCapitalize="words"
          />
          <TouchableOpacity
            style={[
              styles.solidBtn,
              { backgroundColor: recipientName.trim() ? colors.primary : colors.line },
            ]}
            disabled={!recipientName.trim()}
            onPress={() => loadOrCreateDraft(recipientName.trim())}
            activeOpacity={0.85}
          >
            <Text style={styles.solidBtnText}>{t('entryButton')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Multi-step form */}
      {step !== 'recipient' && draft && (
        <>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.line }]}>
            <TouchableOpacity
              onPress={() => (stepIndex === 0 ? setStep('recipient') : setStep(STEPS[stepIndex - 1]))}
              hitSlop={12}
            >
              <Text style={[styles.backChevron, { color: colors.primary }]}>‹</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.ink }]}>
              {t(`steps.${step}`)}
            </Text>
            <View style={styles.stepDots}>
              {STEPS.map((s, i) => (
                <StepDot
                  key={s}
                  active={step === s}
                  done={stepIndex > i}
                  colors={colors}
                />
              ))}
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Paragraph 1 ─────────────────────────────────────── */}
            {step === 'p1' && (
              <View>
                <CoachNote text={t('p1.coachNote')} colors={colors} />
                <Text style={[styles.label, { color: colors.ink }]}>{t('p1.prompt')}</Text>
                <TextInput
                  style={[styles.textArea, { borderColor: colors.line, color: colors.ink }]}
                  placeholder={t('p1.placeholder')}
                  placeholderTextColor={colors.inkSoft}
                  value={draft.p1Body}
                  onChangeText={(v) => updateDraft({ p1Body: v })}
                  multiline
                  textAlignVertical="top"
                />
                <Text style={[styles.label, { color: colors.inkSoft }]}>{t('p1.memoryPrompt')}</Text>
              </View>
            )}

            {/* ── Paragraph 2 ─────────────────────────────────────── */}
            {step === 'p2' && (
              <View>
                <CoachNote text={t('p2.coachNote')} colors={colors} />
                <Text style={[styles.label, { color: colors.ink }]}>{t('p2.openerLabel')}</Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.line, color: colors.ink }]}
                  value={draft.p2OpenerLabel}
                  onChangeText={(v) => updateDraft({ p2OpenerLabel: v })}
                />
                <Text style={[styles.hintsText, { color: colors.inkSoft }]}>{t('p2.hints')}</Text>

                {draft.p2Experiences.map((exp, idx) => {
                  const flagged = hasToneFlag(exp.when + ' ' + exp.felt, i18n.language);
                  return (
                    <View
                      key={idx}
                      style={[
                        styles.expBlock,
                        { borderColor: flagged ? colors.coral : colors.line },
                      ]}
                    >
                      {flagged && (
                        <Text style={[styles.toneFlag, { color: colors.coral }]}>
                          {t('p2.toneFlag')}
                        </Text>
                      )}
                      <TextInput
                        style={[styles.expInput, { borderBottomColor: colors.line, color: colors.ink }]}
                        placeholder={t('p2.whenPlaceholder')}
                        placeholderTextColor={colors.inkSoft}
                        value={exp.when}
                        onChangeText={(v) => updateExperience(idx, 'when', v)}
                      />
                      <TextInput
                        style={[styles.expInput, { borderBottomColor: 'transparent', color: colors.ink }]}
                        placeholder={t('p2.feltPlaceholder')}
                        placeholderTextColor={colors.inkSoft}
                        value={exp.felt}
                        onChangeText={(v) => updateExperience(idx, 'felt', v)}
                      />
                    </View>
                  );
                })}

                {draft.p2Experiences.length < 3 ? (
                  <TouchableOpacity
                    style={[styles.outlineBtn, { borderColor: colors.primary }]}
                    onPress={addExperience}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                      {t('p2.addExperience')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.maxNote, { color: colors.inkSoft }]}>
                    {t('p2.maxReached')}
                  </Text>
                )}
              </View>
            )}

            {/* ── Paragraph 3 ─────────────────────────────────────── */}
            {step === 'p3' && (
              <View>
                <Text style={[styles.label, { color: colors.ink }]}>{t('p3.requestLabel')}</Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.line, color: colors.ink }]}
                  value={draft.p3Request}
                  onChangeText={(v) => updateDraft({ p3Request: v })}
                />
                <Text style={[styles.sublabel, { color: colors.inkSoft }]}>
                  {t('p3.requestNote')}
                </Text>

                <Text style={[styles.label, { color: colors.ink }]}>{t('p3.hopeLabel')}</Text>
                <TextInput
                  style={[styles.textArea, { borderColor: colors.line, color: colors.ink }]}
                  placeholder={t('p3.hopePlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  value={draft.p3Hope}
                  onChangeText={(v) => updateDraft({ p3Hope: v })}
                  multiline
                  textAlignVertical="top"
                />

                <Text style={[styles.label, { color: colors.ink }]}>{t('p3.supportLabel')}</Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.line, color: colors.ink }]}
                  placeholder={t('p3.supportPlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  value={draft.p3HealthySupport}
                  onChangeText={(v) => updateDraft({ p3HealthySupport: v })}
                />

                <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                  {t('p3.boundariesEyebrow')}
                </Text>
                <Text style={[styles.sublabel, { color: colors.inkSoft }]}>
                  {t('p3.boundariesNote')}
                </Text>

                {walls.length === 0 ? (
                  <Text style={[styles.emptyNote, { color: colors.inkSoft }]}>
                    {t('p3.noBoundaries')}
                  </Text>
                ) : (
                  walls.map((wall) => {
                    const confirmed = draft.p3ConfirmedBoundaryIds.includes(wall.id);
                    return (
                      <TouchableOpacity
                        key={wall.id}
                        style={[
                          styles.boundaryRow,
                          {
                            borderColor: confirmed ? colors.green : colors.line,
                            backgroundColor: confirmed ? colors.greenLight : '#fff',
                          },
                        ]}
                        onPress={() => toggleBoundary(wall.id)}
                        activeOpacity={0.8}
                      >
                        <View
                          style={[
                            styles.boundaryCheck,
                            {
                              borderColor: confirmed ? colors.green : colors.line,
                              backgroundColor: confirmed ? colors.green : 'transparent',
                            },
                          ]}
                        >
                          {confirmed && <Text style={styles.checkMark}>✓</Text>}
                        </View>
                        <View style={styles.boundaryText}>
                          <Text style={[styles.wallText, { color: colors.ink }]}>{wall.text}</Text>
                          {confirmed && (
                            <Text style={[styles.confirmLabel, { color: colors.green }]}>
                              {t('p3.boundaryConfirmLabel')}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}

                <Text style={[styles.label, { color: colors.ink, marginTop: 16 }]}>
                  {t('p3.closingLabel')}
                </Text>
                <Text style={[styles.sublabel, { color: colors.inkSoft }]}>
                  {t('p3.closingNote')}
                </Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.line, color: colors.ink }]}
                  value={draft.p3ClosingQuestion}
                  onChangeText={(v) => updateDraft({ p3ClosingQuestion: v })}
                />
              </View>
            )}

            {/* ── Preview ──────────────────────────────────────────── */}
            {step === 'preview' && (
              <View>
                {/* Brevity meter */}
                <View style={[styles.meterCard, { borderColor: colors.line }]}>
                  <View style={styles.meterRow}>
                    <Text style={[styles.meterLabel, { color: colors.inkSoft }]}>
                      {t('preview.brevityLabel')}
                    </Text>
                    <Text style={[styles.meterLabel, { color: colors.inkSoft }]}>
                      {t('preview.readTime', { min: readMinutes(draft) })}
                    </Text>
                  </View>
                  <View style={[styles.meterTrack, { backgroundColor: colors.line }]}>
                    <View
                      style={[
                        styles.meterFill,
                        {
                          width: `${Math.min(fill, 100)}%`,
                          backgroundColor: fillColor,
                        },
                      ]}
                    />
                  </View>
                  {fill > 100 && (
                    <Text style={[styles.overflowWarning, { color: colors.coral }]}>
                      {t('preview.overflowWarning')}
                    </Text>
                  )}
                </View>

                {/* Assembled letter */}
                <View style={[styles.letterCard, { borderColor: colors.line }]}>
                  <Text style={[styles.letterText, { color: colors.ink }]}>
                    {assembleLetterText(draft) || '…'}
                  </Text>
                </View>

                {/* Actions */}
                <TouchableOpacity
                  style={[styles.solidBtn, { backgroundColor: colors.primary }]}
                  onPress={shareExport}
                  activeOpacity={0.85}
                >
                  <Text style={styles.solidBtnText}>{t('preview.shareButton')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.primary }]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                    {isAttached ? t('preview.coachButton') : t('preview.coachButtonDirect')}
                  </Text>
                </TouchableOpacity>

                {/* Referral hook (direct only) */}
                {!isAttached && (
                  <View style={[styles.referralCard, { backgroundColor: colors.secondaryLight, borderColor: colors.sand }]}>
                    <Text style={[styles.referralText, { color: colors.ink }]}>
                      {t('preview.referralCard')}
                    </Text>
                    <TouchableOpacity activeOpacity={0.8}>
                      <Text style={[styles.referralBtn, { color: colors.secondary }]}>
                        {t('preview.referralButton')} →
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Save indicator */}
            {saving && (
              <Text style={[styles.saveLabel, { color: colors.inkSoft }]}>{t('save')}…</Text>
            )}

            {/* Navigation */}
            {step !== 'preview' && (
              <TouchableOpacity
                style={[styles.solidBtn, { backgroundColor: colors.primary, marginTop: 24 }]}
                onPress={() => setStep(STEPS[stepIndex + 1])}
                activeOpacity={0.85}
              >
                <Text style={styles.solidBtnText}>{t('next')} →</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

function CoachNote({ text, colors }: { text: string; colors: any }) {
  return (
    <View style={[styles.coachNote, { backgroundColor: colors.secondaryLight, borderLeftColor: colors.secondary }]}>
      <Text style={[styles.coachNoteText, { color: colors.ink }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 60, alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backChevron: { fontSize: 30, fontWeight: '300', lineHeight: 34 },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  stepDots: { flexDirection: 'row', gap: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  backRow: { marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4, marginBottom: 8 },
  entryBody: { fontSize: 14, lineHeight: 21, marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 16 },
  sublabel: { fontSize: 12, marginBottom: 10, lineHeight: 17 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#fff',
    minHeight: 120,
  },
  coachNote: {
    borderLeftWidth: 3,
    borderRadius: 0,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  coachNoteText: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  hintsText: { fontSize: 12, lineHeight: 18, marginBottom: 12, fontStyle: 'italic' },
  expBlock: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  toneFlag: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  expInput: {
    fontSize: 14,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  boundaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  boundaryCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  boundaryText: { flex: 1 },
  wallText: { fontSize: 13.5, lineHeight: 20 },
  confirmLabel: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  meterCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  meterRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  meterLabel: { fontSize: 12 },
  meterTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  overflowWarning: { fontSize: 12, marginTop: 8, fontWeight: '600' },
  letterCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  letterText: { fontSize: 15, lineHeight: 24 },
  solidBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  solidBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  outlineBtn: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  outlineBtnText: { fontWeight: '700', fontSize: 14 },
  referralCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
  },
  referralText: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  referralBtn: { fontSize: 14, fontWeight: '700' },
  saveLabel: { fontSize: 11, textAlign: 'center', marginTop: 4 },
  emptyNote: { fontSize: 13, fontStyle: 'italic', marginBottom: 8 },
  maxNote: { fontSize: 12, textAlign: 'center', fontStyle: 'italic', marginBottom: 8 },
});
