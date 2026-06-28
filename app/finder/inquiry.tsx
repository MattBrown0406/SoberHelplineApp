import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { Button } from '../../src/components/ui/Button';
import { useTheme } from '../../src/contexts/ThemeContext';
import { getProvider } from '../../src/api/providers';

const RELATIONSHIPS = ['Parent', 'Spouse / partner', 'Sibling', 'Adult child', 'Friend', 'Other'];
const TIMES = ['Anytime', 'Morning', 'Afternoon', 'Evening'];

export default function InquiryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const provider = getProvider(id);

  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0]);
  const [phone, setPhone] = useState('');
  const [bestTime, setBestTime] = useState(TIMES[0]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    // v1: local confirmation. Wire to a Supabase `referral_requests` insert
    // (provider_id, account_id, contact, note) + navigator notification in P1.
    setSubmitted(true);
  }

  if (submitted) {
    const first = name.trim().split(' ')[0];
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        <View style={styles.confirm}>
          <View style={[styles.ring, { backgroundColor: colors.greenLight }]}>
            <Text style={[styles.ringMark, { color: colors.green }]}>✓</Text>
          </View>
          <Text style={[styles.h1, { color: colors.primary, textAlign: 'center' }]}>Your request is in.</Text>
          <Text style={[styles.lede, { color: colors.inkSoft, textAlign: 'center' }]}>
            {first ? `${first}, you're` : "You're"} not doing this alone. We've sent your inquiry{provider ? ` about ${provider.name}` : ''}.
          </Text>
          <View style={[styles.nextbox, { borderColor: colors.line }]}>
            {[
              'A Sober Helpline navigator reviews your request and the provider\'s current availability.',
              'They call or text you (your choice) to confirm fit, insurance, and next steps.',
              'If it\'s a fit, they warm-introduce you directly to the provider — and stay with you.',
            ].map((s, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={[styles.num, { backgroundColor: colors.primary }]}>
                  <Text style={styles.numText}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepText, { color: colors.ink }]}>{s}</Text>
              </View>
            ))}
          </View>
          <Button label="Back to results" variant="ghost" onPress={() => router.dismissAll?.() ?? router.replace('/finder')} />
          <Text style={[styles.disc, { color: colors.inkSoft }]}>
            In immediate danger? Call 911. For the 24/7 Suicide & Crisis Lifeline, call or text 988.
          </Text>
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
        <Text style={[styles.barTitle, { color: colors.primary }]}>Request information</Text>
      </View>

      <Text style={[styles.h1, { color: colors.primary }]}>
        {provider ? `Request a consult — ${provider.name}` : 'Request information'}
      </Text>
      <Text style={[styles.lede, { color: colors.inkSoft }]}>
        A Sober Helpline navigator will reach out — usually within a few hours — to help you take the next step. No cost, no pressure.
      </Text>

      <Field label="Your name">
        <TextInput value={name} onChangeText={setName} placeholder="First and last name" placeholderTextColor={colors.inkSoft} style={inputStyle(colors)} />
      </Field>

      <Field label="Your relationship to your loved one">
        <Pills options={RELATIONSHIPS} value={relationship} onChange={setRelationship} />
      </Field>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Field label="Phone">
            <TextInput value={phone} onChangeText={setPhone} placeholder="(555) 555-5555" keyboardType="phone-pad" placeholderTextColor={colors.inkSoft} style={inputStyle(colors)} />
          </Field>
        </View>
      </View>

      <Field label="Best time to reach you">
        <Pills options={TIMES} value={bestTime} onChange={setBestTime} />
      </Field>

      <Field label="Email">
        <TextInput value={email} onChangeText={setEmail} placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" placeholderTextColor={colors.inkSoft} style={inputStyle(colors)} />
      </Field>

      <Field label="Briefly, what's going on? (optional)">
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="A sentence or two helps us match you faster — substance, urgency, anything you'd want us to know."
          placeholderTextColor={colors.inkSoft}
          multiline
          style={[inputStyle(colors), { minHeight: 90, textAlignVertical: 'top' }]}
        />
      </Field>

      <Button label="Send request" onPress={submit} disabled={!name.trim() || (!phone.trim() && !email.trim())} style={{ marginTop: 12 }} />
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

function Pills({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.pills}>
      {options.map((o) => {
        const sel = value === o;
        return (
          <TouchableOpacity
            key={o}
            onPress={() => onChange(o)}
            activeOpacity={0.8}
            style={[styles.pill, { borderColor: sel ? colors.primary : colors.line, backgroundColor: sel ? colors.primary : '#fff' }]}
          >
            <Text style={{ fontSize: 13.5, color: sel ? '#fff' : colors.ink }}>{o}</Text>
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
