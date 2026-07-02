import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { Button } from '../../src/components/ui/Button';
import { useTheme } from '../../src/contexts/ThemeContext';
import { submitProviderInquiry } from '../../src/api/providers';

// Canonical values sent to the navigator team (always English); display labels
// come from the finder namespace by index.
const RELATIONSHIP_VALUES = ['Parent', 'Spouse / partner', 'Sibling', 'Adult child', 'Friend', 'Other'];
const TIME_VALUES = ['Anytime', 'Morning', 'Afternoon', 'Evening'];

export default function InquiryScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('finder');
  const router = useRouter();
  const { id: providerId, name: providerName } = useLocalSearchParams<{ id: string; name: string }>();

  const relationshipLabels = t('inquiry.relationships', { returnObjects: true }) as string[];
  const timeLabels = t('inquiry.times', { returnObjects: true }) as string[];
  const steps = t('inquiry.steps', { returnObjects: true }) as string[];

  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIP_VALUES[0]);
  const [phone, setPhone] = useState('');
  const [bestTime, setBestTime] = useState(TIME_VALUES[0]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  async function submit() {
    setSending(true);
    try {
      await submitProviderInquiry({
        providerId,
        providerName,
        requesterName: name.trim(),
        relationship,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        bestTime,
        note: note.trim() || undefined,
      });
      setSubmitted(true);
    } catch {
      Alert.alert(t('inquiry.errorTitle'), t('inquiry.errorBody'));
    } finally {
      setSending(false);
    }
  }

  if (submitted) {
    const first = name.trim().split(' ')[0];
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        <View style={styles.confirm}>
          <View style={[styles.ring, { backgroundColor: colors.greenLight }]}>
            <Text style={[styles.ringMark, { color: colors.green }]}>✓</Text>
          </View>
          <Text style={[styles.h1, { color: colors.primary, textAlign: 'center' }]}>{t('inquiry.confirmTitle')}</Text>
          <Text style={[styles.lede, { color: colors.inkSoft, textAlign: 'center' }]}>
            {first && providerName
              ? t('inquiry.confirmLedeNamed', { first, provider: providerName })
              : t('inquiry.confirmLede')}
          </Text>
          <View style={[styles.nextbox, { borderColor: colors.line }]}>
            {steps.map((s, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={[styles.num, { backgroundColor: colors.primary }]}>
                  <Text style={styles.numText}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepText, { color: colors.ink }]}>{s}</Text>
              </View>
            ))}
          </View>
          <Button label={t('inquiry.backToResults')} variant="ghost" onPress={() => router.dismissAll?.() ?? router.replace('/finder')} />
          <Text style={[styles.disc, { color: colors.inkSoft }]}>{t('inquiry.crisisNote')}</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <View style={styles.bar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.back, { borderColor: colors.line }]}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.barTitle, { color: colors.primary }]}>{t('inquiry.barTitle')}</Text>
      </View>

      <Text style={[styles.h1, { color: colors.primary }]}>
        {providerName ? t('inquiry.h1Named', { name: providerName }) : t('inquiry.h1')}
      </Text>
      <Text style={[styles.lede, { color: colors.inkSoft }]}>{t('inquiry.lede')}</Text>

      <Field label={t('inquiry.nameLabel')}>
        <TextInput value={name} onChangeText={setName} placeholder={t('inquiry.namePlaceholder')} placeholderTextColor={colors.inkSoft} style={inputStyle(colors)} />
      </Field>

      <Field label={t('inquiry.relationshipLabel')}>
        <Pills values={RELATIONSHIP_VALUES} labels={relationshipLabels} value={relationship} onChange={setRelationship} />
      </Field>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Field label={t('inquiry.phoneLabel')}>
            <TextInput value={phone} onChangeText={setPhone} placeholder={t('inquiry.phonePlaceholder')} keyboardType="phone-pad" placeholderTextColor={colors.inkSoft} style={inputStyle(colors)} />
          </Field>
        </View>
      </View>

      <Field label={t('inquiry.bestTimeLabel')}>
        <Pills values={TIME_VALUES} labels={timeLabels} value={bestTime} onChange={setBestTime} />
      </Field>

      <Field label={t('inquiry.emailLabel')}>
        <TextInput value={email} onChangeText={setEmail} placeholder={t('inquiry.emailPlaceholder')} keyboardType="email-address" autoCapitalize="none" placeholderTextColor={colors.inkSoft} style={inputStyle(colors)} />
      </Field>

      <Field label={t('inquiry.noteLabel')}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t('inquiry.notePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          multiline
          style={[inputStyle(colors), { minHeight: 90, textAlignVertical: 'top' }]}
        />
      </Field>

      <Button
        label={sending ? t('inquiry.sending') : t('inquiry.send')}
        onPress={submit}
        disabled={sending || !name.trim() || (!phone.trim() && !email.trim())}
        style={{ marginTop: 12 }}
      />
    </ScreenContainer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]}>{label}</Text>
      {children}
    </View>
  );
}

function Pills({
  values,
  labels,
  value,
  onChange,
}: {
  values: string[];
  labels: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.pills}>
      {values.map((v, i) => {
        const sel = value === v;
        return (
          <TouchableOpacity
            key={v}
            onPress={() => onChange(v)}
            activeOpacity={0.8}
            style={[styles.pill, { borderColor: sel ? colors.primary : colors.line, backgroundColor: sel ? colors.primary : '#fff' }]}
          >
            <Text style={{ fontSize: 13.5, color: sel ? '#fff' : colors.ink }}>{labels[i] ?? v}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function inputStyle(colors: ReturnType<typeof useTheme>['colors']) {
  return { borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 13, fontSize: 15, backgroundColor: '#fff', color: colors.ink };
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  back: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, marginTop: -2 },
  barTitle: { fontSize: 16, fontWeight: '700' },
  h1: { fontSize: 23, fontWeight: '700', marginTop: 12, marginBottom: 8, lineHeight: 28 },
  lede: { fontSize: 15, lineHeight: 22, marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 7 },
  row2: { flexDirection: 'row', gap: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 22, borderWidth: 1 },
  confirm: { alignItems: 'center', paddingTop: 30 },
  ring: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  ringMark: { fontSize: 42, fontWeight: '700' },
  nextbox: { backgroundColor: '#fff', borderWidth: 1, borderRadius: 14, padding: 16, marginVertical: 20, width: '100%' },
  stepRow: { flexDirection: 'row', gap: 11, marginBottom: 13 },
  num: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  numText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  stepText: { flex: 1, fontSize: 14, lineHeight: 20 },
  disc: { fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 14 },
});
