import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import {
  normalizeRecoveryPhase,
  pathwayDaySlot,
  RECOVERY_PHASE_ROUTE,
  RECOVERY_PHASES,
  type RecoveryPhase,
} from '../../lib/recoveryPathway';

interface Props {
  stage: string | null | undefined;
  status: string | null | undefined;
  loading?: boolean;
  onSavePhase: (phase: RecoveryPhase) => Promise<unknown>;
}

const GUIDANCE_ROWS = [
  { key: 'do', icon: '✓' },
  { key: 'avoid', icon: '—' },
  { key: 'expect', icon: '○' },
] as const;

export function RecoveryPathwayCard({
  stage,
  status,
  loading = false,
  onSavePhase,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();
  const phase = normalizeRecoveryPhase(stage, status);
  const slot = pathwayDaySlot(new Date());
  const [editing, setEditing] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<RecoveryPhase>(phase);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setSelectedPhase(phase);
  }, [phase]);

  const savePhase = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      await onSavePhase(selectedPhase);
      setEditing(false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('pathway.eyebrow')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('pathway.title')}</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('pathway.changePhase')}
          disabled={loading}
          onPress={() => {
            setSelectedPhase(phase);
            setSaveError(false);
            setEditing((value) => !value);
          }}
          style={[styles.phasePill, { backgroundColor: colors.primaryLight }]}
          activeOpacity={0.75}
        >
          <Text style={[styles.phasePillText, { color: colors.primary }]}>
            {loading ? t('pathway.loading') : t(`pathway.phases.${phase}.label`)}
          </Text>
          {!loading && <Text style={[styles.editMark, { color: colors.primary }]}>⌄</Text>}
        </TouchableOpacity>
      </View>

      {editing && !loading && (
        <View style={[styles.editor, { backgroundColor: colors.cream, borderColor: colors.line }]}>
          <Text style={[styles.editorLabel, { color: colors.ink }]}>{t('pathway.choosePhase')}</Text>
          <View style={styles.options}>
            {RECOVERY_PHASES.map((option) => {
              const selected = option === selectedPhase;
              return (
                <TouchableOpacity
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setSelectedPhase(option)}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected ? colors.primary : colors.white,
                      borderColor: selected ? colors.primary : colors.line,
                    },
                  ]}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.optionText, { color: selected ? '#fff' : colors.ink }]}>
                    {t(`pathway.phases.${option}.label`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void savePhase()}
            style={[
              styles.saveButton,
              { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 },
            ]}
            activeOpacity={0.82}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>{t('pathway.savePhase')}</Text>
            )}
          </TouchableOpacity>
          {saveError && (
            <Text style={[styles.errorText, { color: colors.coral }]}>
              {t('pathway.saveError')}
            </Text>
          )}
        </View>
      )}

      {!loading && (
        <>
          <Text style={[styles.description, { color: colors.inkSoft }]}>
            {t(`pathway.phases.${phase}.description`)}
          </Text>

          <View style={[styles.guidance, { borderColor: colors.line }]}>
            {GUIDANCE_ROWS.map((row, index) => (
              <View
                key={row.key}
                style={[
                  styles.guidanceRow,
                  index < GUIDANCE_ROWS.length - 1 && {
                    borderBottomColor: colors.line,
                    borderBottomWidth: 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.guidanceIcon,
                    {
                      backgroundColor:
                        row.key === 'do'
                          ? colors.greenLight
                          : row.key === 'avoid'
                            ? colors.coralLight
                            : colors.primaryLight,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.guidanceIconText,
                      {
                        color:
                          row.key === 'do'
                            ? colors.green
                            : row.key === 'avoid'
                              ? colors.coral
                              : colors.primary,
                      },
                    ]}
                  >
                    {row.icon}
                  </Text>
                </View>
                <View style={styles.guidanceText}>
                  <Text style={[styles.guidanceLabel, { color: colors.ink }]}>
                    {t(`pathway.guidance.${row.key}`)}
                  </Text>
                  <Text style={[styles.guidanceBody, { color: colors.inkSoft }]}>
                    {t(`pathway.phases.${phase}.${row.key}.${slot}`)}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.push(RECOVERY_PHASE_ROUTE[phase] as never)}
            style={[styles.nextButton, { borderColor: colors.primary }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.nextButtonText, { color: colors.primary }]}>
              {t(`pathway.phases.${phase}.cta`)}
            </Text>
            <Text style={[styles.chevron, { color: colors.primary }]}>›</Text>
          </TouchableOpacity>

          <Text style={[styles.privacy, { color: colors.inkSoft }]}>{t('pathway.privacy')}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerText: { flex: 1 },
  eyebrow: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  title: { fontSize: 19, fontWeight: '700', letterSpacing: -0.25, marginTop: 4 },
  phasePill: {
    maxWidth: '48%',
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phasePillText: {
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  editMark: { fontSize: 13, fontWeight: '800' },
  editor: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 14 },
  editorLabel: { fontSize: 13, fontWeight: '700', marginBottom: 10 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 7 },
  optionText: { fontSize: 11.5, fontWeight: '600' },
  saveButton: {
    minHeight: 43,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  saveButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  errorText: { fontSize: 12, textAlign: 'center', marginTop: 8 },
  description: { fontSize: 13.5, lineHeight: 20, marginTop: 12, marginBottom: 14 },
  guidance: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  guidanceRow: { flexDirection: 'row', gap: 11, padding: 12, alignItems: 'flex-start' },
  guidanceIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidanceIconText: { fontSize: 15, fontWeight: '800' },
  guidanceText: { flex: 1 },
  guidanceLabel: { fontSize: 12.5, fontWeight: '700', marginBottom: 2 },
  guidanceBody: { fontSize: 12.5, lineHeight: 18 },
  nextButton: {
    borderWidth: 1.5,
    borderRadius: 99,
    paddingVertical: 11,
    paddingHorizontal: 15,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  nextButtonText: { fontSize: 13.5, fontWeight: '700' },
  chevron: { fontSize: 19, lineHeight: 19 },
  privacy: { fontSize: 10.5, lineHeight: 15, textAlign: 'center', marginTop: 10 },
});
