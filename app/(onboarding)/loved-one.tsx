import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { useLovedOne, type LovedOneStatus } from '../../src/hooks/useLovedOne';

const RELATIONSHIPS = ['son', 'daughter', 'spouse', 'partner', 'parent', 'sibling', 'friend', 'other'] as const;
const SUBSTANCES = ['alcohol', 'opioids', 'stimulants', 'cannabis', 'prescription', 'other'] as const;
const STAGES = ['using', 'seeking_help', 'in_treatment', 'recovery', 'unsure'] as const;
const STATUSES: LovedOneStatus[] = ['stable', 'using', 'escalating', 'crisis'];

export default function LovedOneScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('onboarding');
  const { user } = useAccount();
  const router = useRouter();
  const { save } = useLovedOne(user?.id ?? null);

  const [relationship, setRelationship] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [substances, setSubstances] = useState<string[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const [status, setStatus] = useState<LovedOneStatus | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleSubstance(s: string) {
    setSubstances((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function handleContinue() {
    setSaving(true);
    try {
      await save({
        relationship,
        first_name: firstName.trim() || null,
        substances,
        stage,
        status: status ?? 'unknown',
      });
      router.push('/(onboarding)/notifications');
    } catch {
      Alert.alert(t('saveError.title'), t('saveError.body'));
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    router.push('/(onboarding)/notifications');
  }

  const Chip = ({
    label,
    selected,
    onPress,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.white,
          borderColor: selected ? colors.primary : colors.line,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? '#fff' : colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.icon}>💙</Text>
        <Text style={[styles.title, { color: colors.ink }]}>{t('lovedOne.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.inkSoft }]}>{t('lovedOne.subtitle')}</Text>

        <Text style={[styles.label, { color: colors.ink }]}>{t('lovedOne.relationshipLabel')}</Text>
        <View style={styles.chipWrap}>
          {RELATIONSHIPS.map((r) => (
            <Chip
              key={r}
              label={t(`lovedOne.relationship.${r}`)}
              selected={relationship === r}
              onPress={() => setRelationship(r)}
            />
          ))}
        </View>

        <Text style={[styles.label, { color: colors.ink }]}>{t('lovedOne.firstNameLabel')}</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.line, color: colors.ink, backgroundColor: colors.white }]}
          placeholder={t('lovedOne.firstNamePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
        />

        <Text style={[styles.label, { color: colors.ink }]}>{t('lovedOne.substancesLabel')}</Text>
        <View style={styles.chipWrap}>
          {SUBSTANCES.map((s) => (
            <Chip
              key={s}
              label={t(`lovedOne.substances.${s}`)}
              selected={substances.includes(s)}
              onPress={() => toggleSubstance(s)}
            />
          ))}
        </View>

        <Text style={[styles.label, { color: colors.ink }]}>{t('lovedOne.stageLabel')}</Text>
        <View style={styles.chipWrap}>
          {STAGES.map((s) => (
            <Chip
              key={s}
              label={t(`lovedOne.stage.${s}`)}
              selected={stage === s}
              onPress={() => setStage(s)}
            />
          ))}
        </View>

        <Text style={[styles.label, { color: colors.ink }]}>{t('lovedOne.statusLabel')}</Text>
        <View style={styles.chipWrap}>
          {STATUSES.map((s) => (
            <Chip
              key={s}
              label={t(`lovedOne.status.${s}`)}
              selected={status === s}
              onPress={() => setStatus(s)}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={handleContinue}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{t('lovedOne.saveButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={skip} disabled={saving}>
          <Text style={[styles.skipText, { color: colors.inkSoft }]}>{t('lovedOne.skipButton')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 28, alignSelf: 'center', width: '100%', maxWidth: 480, paddingBottom: 48 },
  icon: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 23, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { fontSize: 14.5, lineHeight: 22, marginTop: 10, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '700', marginTop: 22, marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 99, paddingVertical: 9, paddingHorizontal: 16 },
  chipText: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  primaryBtn: { borderRadius: 99, paddingVertical: 15, alignItems: 'center', marginTop: 32 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  skipBtn: { alignItems: 'center', marginTop: 16 },
  skipText: { fontSize: 14, fontWeight: '600' },
});
