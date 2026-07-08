import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { usePrivateVideoSessions } from '../src/hooks/usePrivateVideoSessions';

type RiskLevel = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
type TriageKey =
  | 'notBreathing'
  | 'overdose'
  | 'suicide'
  | 'violence'
  | 'weapons'
  | 'childrenPresent'
  | 'drivingIntoxicated'
  | 'missing'
  | 'intoxicated'
  | 'aggressive'
  | 'askingMoney'
  | 'willingTalk';

type Incident = {
  id: string;
  createdAt: string;
  summary: string;
  substances: string;
  threats: string;
  childrenPresent: boolean;
  policeOrEms: boolean;
  boundaryCrossed: boolean;
};

type SafetyPlan = {
  lovedOneName: string;
  substances: string;
  overdoseHistory: string;
  suicideHistory: string;
  weaponsAccess: string;
  childrenInHome: string;
  emergencyContacts: string;
  preferredHospital: string;
  insurance: string;
  currentBoundaries: string;
  decisionMakers: string;
};

type BoundaryDraft = {
  behavior: string;
  support: string;
  noLongerDo: string;
  consequence: string;
};

type Readiness = {
  familyAligned: boolean;
  moneyStopped: boolean;
  treatmentReady: boolean;
  transportPlanned: boolean;
  consequencesClear: boolean;
  refusalPlan: boolean;
  yesPlan: boolean;
};

// Labels live in the `crisis` namespace under triage.items.<key>.
const TRIAGE: { key: TriageKey; red?: boolean; orange?: boolean }[] = [
  { key: 'notBreathing', red: true },
  { key: 'overdose', red: true },
  { key: 'suicide', red: true },
  { key: 'violence', red: true },
  { key: 'weapons', red: true },
  { key: 'drivingIntoxicated', red: true },
  { key: 'childrenPresent', orange: true },
  { key: 'missing', orange: true },
  { key: 'intoxicated', orange: true },
  { key: 'aggressive', orange: true },
  { key: 'askingMoney', orange: true },
  { key: 'willingTalk' },
];

const DEFAULT_PLAN: SafetyPlan = {
  lovedOneName: '',
  substances: '',
  overdoseHistory: '',
  suicideHistory: '',
  weaponsAccess: '',
  childrenInHome: '',
  emergencyContacts: '',
  preferredHospital: '',
  insurance: '',
  currentBoundaries: '',
  decisionMakers: '',
};

const DEFAULT_BOUNDARY: BoundaryDraft = {
  behavior: '',
  support: '',
  noLongerDo: '',
  consequence: '',
};

const DEFAULT_READINESS: Readiness = {
  familyAligned: false,
  moneyStopped: false,
  treatmentReady: false,
  transportPlanned: false,
  consequencesClear: false,
  refusalPlan: false,
  yesPlan: false,
};

const PLAN_FIELDS: (keyof SafetyPlan)[] = [
  'lovedOneName', 'substances', 'overdoseHistory', 'suicideHistory', 'weaponsAccess',
  'childrenInHome', 'emergencyContacts', 'preferredHospital', 'insurance',
  'currentBoundaries', 'decisionMakers',
];
const PLAN_MULTILINE = new Set<keyof SafetyPlan>(['emergencyContacts', 'currentBoundaries']);

const READINESS_KEYS: (keyof Readiness)[] = [
  'familyAligned', 'moneyStopped', 'treatmentReady', 'transportPlanned',
  'consequencesClear', 'refusalPlan', 'yesPlan',
];

function crisisStorageKey(userId: string | null | undefined, suffix: string) {
  return `soberhelpline:crisis:${userId ?? 'guest'}:${suffix}`;
}

function levelColor(level: RiskLevel) {
  if (level === 'RED') return '#b42318';
  if (level === 'ORANGE') return '#c4604f';
  if (level === 'YELLOW') return '#d9913b';
  return '#4d7c5f';
}

function checklistKey(level: RiskLevel, selected: Record<TriageKey, boolean>): string {
  if (level === 'RED') {
    if (selected.notBreathing || selected.overdose) return 'redOverdose';
    if (selected.suicide) return 'redSuicide';
    return 'redDefault';
  }
  if (level === 'ORANGE') return 'orange';
  return 'default';
}

function scriptKey(selected: Record<TriageKey, boolean>, level: RiskLevel): string {
  if (level === 'RED') return 'red';
  if (selected.askingMoney) return 'money';
  if (selected.intoxicated || selected.aggressive) return 'escalated';
  if (selected.willingTalk) return 'willing';
  return 'default';
}

function buildBoundary(draft: BoundaryDraft, t: TFunction<'crisis'>) {
  return t('builder.template', {
    behavior: draft.behavior.trim() || t('builder.defaults.behavior'),
    support: draft.support.trim() || t('builder.defaults.support'),
    noLongerDo: draft.noLongerDo.trim() || t('builder.defaults.noLongerDo'),
    consequence: draft.consequence.trim() || t('builder.defaults.consequence'),
  });
}

function readinessScore(readiness: Readiness) {
  const values = Object.values(readiness);
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}

export default function CrisisModeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('crisis');
  const { user, entitlements } = useAccount();
  const canAccessPrivateVideo = !!user && entitlements.canAccessPrivateVideo;
  const { activeSession, requestSession, requesting } = usePrivateVideoSessions(user?.id ?? null, canAccessPrivateVideo);

  const [selected, setSelected] = useState<Record<TriageKey, boolean>>(() =>
    TRIAGE.reduce((acc, q) => ({ ...acc, [q.key]: false }), {} as Record<TriageKey, boolean>)
  );
  const [plan, setPlan] = useState<SafetyPlan>(DEFAULT_PLAN);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentDraft, setIncidentDraft] = useState<Omit<Incident, 'id' | 'createdAt'>>({
    summary: '',
    substances: '',
    threats: '',
    childrenPresent: false,
    policeOrEms: false,
    boundaryCrossed: false,
  });
  const [boundary, setBoundary] = useState<BoundaryDraft>(DEFAULT_BOUNDARY);
  const [readiness, setReadiness] = useState<Readiness>(DEFAULT_READINESS);

  const level: RiskLevel = useMemo(() => {
    if (TRIAGE.some((q) => q.red && selected[q.key])) return 'RED';
    const orangeCount = TRIAGE.filter((q) => q.orange && selected[q.key]).length;
    if (orangeCount >= 2) return 'ORANGE';
    if (orangeCount === 1) return 'YELLOW';
    return 'GREEN';
  }, [selected]);

  const checklist = t(`checklist.${checklistKey(level, selected)}`, { returnObjects: true }) as string[];
  const script = t(`say.${scriptKey(selected, level)}`);
  const boundaryText = buildBoundary(boundary, t);
  const score = readinessScore(readiness);
  const fieldPlaceholder = t('field.placeholder');

  useEffect(() => {
    async function load() {
      const [planRaw, incidentsRaw, readinessRaw, boundaryRaw] = await Promise.all([
        AsyncStorage.getItem(crisisStorageKey(user?.id, 'plan')),
        AsyncStorage.getItem(crisisStorageKey(user?.id, 'incidents')),
        AsyncStorage.getItem(crisisStorageKey(user?.id, 'readiness')),
        AsyncStorage.getItem(crisisStorageKey(user?.id, 'boundary')),
      ]);
      if (planRaw) setPlan({ ...DEFAULT_PLAN, ...JSON.parse(planRaw) });
      if (incidentsRaw) setIncidents(JSON.parse(incidentsRaw));
      if (readinessRaw) setReadiness({ ...DEFAULT_READINESS, ...JSON.parse(readinessRaw) });
      if (boundaryRaw) setBoundary({ ...DEFAULT_BOUNDARY, ...JSON.parse(boundaryRaw) });
    }
    void load();
  }, [user?.id]);

  useEffect(() => {
    void AsyncStorage.setItem(crisisStorageKey(user?.id, 'plan'), JSON.stringify(plan));
  }, [plan, user?.id]);

  useEffect(() => {
    void AsyncStorage.setItem(crisisStorageKey(user?.id, 'incidents'), JSON.stringify(incidents));
  }, [incidents, user?.id]);

  useEffect(() => {
    void AsyncStorage.setItem(crisisStorageKey(user?.id, 'readiness'), JSON.stringify(readiness));
  }, [readiness, user?.id]);

  useEffect(() => {
    void AsyncStorage.setItem(crisisStorageKey(user?.id, 'boundary'), JSON.stringify(boundary));
  }, [boundary, user?.id]);

  function toggle(key: TriageKey) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function addIncident() {
    if (!incidentDraft.summary.trim()) {
      Alert.alert(t('incident.alertTitle'), t('incident.alertBody'));
      return;
    }
    const next: Incident = {
      ...incidentDraft,
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setIncidents((prev) => [next, ...prev].slice(0, 25));
    setIncidentDraft({ summary: '', substances: '', threats: '', childrenPresent: false, policeOrEms: false, boundaryCrossed: false });
  }

  async function handleVideo() {
    if (!canAccessPrivateVideo) {
      Alert.alert(t('videoAlerts.gateTitle'), t('videoAlerts.gateBody'));
      return;
    }
    const session = activeSession ?? await requestSession();
    if (session?.status === 'live') {
      router.push({ pathname: '/video-session' as never, params: { room: session.room_name } });
    } else {
      Alert.alert(t('videoAlerts.queuedTitle'), t('videoAlerts.queuedBody'));
    }
  }

  async function shareSummary() {
    const notEntered = t('share.notEntered');
    const v = (value: string) => value || notEntered;
    const recent = incidents.slice(0, 5).map((i) => `- ${new Date(i.createdAt).toLocaleString()}: ${i.summary}`).join('\n') || t('share.noIncidents');
    const message = [
      t('share.heading'),
      '',
      `${t('share.riskLevel')}: ${level}`,
      t(`risk.${level}.title`),
      '',
      `${t('share.lovedOne')}: ${v(plan.lovedOneName)}`,
      `${t('share.substances')}: ${v(plan.substances)}`,
      `${t('share.overdoseHistory')}: ${v(plan.overdoseHistory)}`,
      `${t('share.suicideHistory')}: ${v(plan.suicideHistory)}`,
      `${t('share.weaponsAccess')}: ${v(plan.weaponsAccess)}`,
      `${t('share.childrenInHome')}: ${v(plan.childrenInHome)}`,
      `${t('share.emergencyContacts')}: ${v(plan.emergencyContacts)}`,
      `${t('share.preferredHospital')}: ${v(plan.preferredHospital)}`,
      `${t('share.insurance')}: ${v(plan.insurance)}`,
      `${t('share.decisionMakers')}: ${v(plan.decisionMakers)}`,
      '',
      t('share.script'),
      script,
      '',
      t('share.boundary'),
      boundaryText,
      '',
      t('share.readiness', { score }),
      '',
      t('share.recent'),
      recent,
      '',
      t('share.note'),
    ].join('\n');
    await Share.share({ title: t('share.title'), message });
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.cream }]}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
        </TouchableOpacity>

        <View style={[styles.hero, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.kicker, { color: colors.coral }]}>{t('kicker').toUpperCase()}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('intro')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('triage.title')}</Text>
          {TRIAGE.map((q) => (
            <TouchableOpacity key={q.key} style={[styles.checkRow, { borderColor: selected[q.key] ? levelColor(level) : colors.line }]} onPress={() => toggle(q.key)}>
              <View style={[styles.box, { backgroundColor: selected[q.key] ? levelColor(level) : colors.white, borderColor: selected[q.key] ? levelColor(level) : colors.line }]}>
                <Text style={styles.boxText}>{selected[q.key] ? '✓' : ''}</Text>
              </View>
              <Text style={[styles.checkText, { color: colors.ink }]}>{t(`triage.items.${q.key}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.riskCard, { backgroundColor: levelColor(level) }]}>
          <Text style={styles.riskKicker}>{t('risk.kicker').toUpperCase()}</Text>
          <Text style={styles.riskLevel}>{level}</Text>
          <Text style={styles.riskTitle}>{t(`risk.${level}.title`)}</Text>
          <Text style={styles.riskBody}>{t(`risk.${level}.body`)}</Text>
          <Text style={styles.riskAction}>{t(`risk.${level}.action`)}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('checklist.title')}</Text>
          {checklist.map((item, index) => (
            <View key={item} style={styles.stepRow}>
              <Text style={[styles.stepNum, { color: colors.primary }]}>{index + 1}</Text>
              <Text style={[styles.body, { color: colors.ink }]}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('say.title')}</Text>
          <View style={[styles.scriptBox, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.script, { color: colors.ink }]}>{script}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('plan.title')}</Text>
          {PLAN_FIELDS.map((key) => (
            <Field
              key={key}
              label={t(`plan.${key}`)}
              placeholder={fieldPlaceholder}
              value={plan[key]}
              onChangeText={(v) => setPlan((prev) => ({ ...prev, [key]: v }))}
              multiline={PLAN_MULTILINE.has(key)}
            />
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('incident.title')}</Text>
          <Field label={t('incident.what')} placeholder={fieldPlaceholder} value={incidentDraft.summary} onChangeText={(v) => setIncidentDraft({ ...incidentDraft, summary: v })} multiline />
          <Field label={t('incident.substances')} placeholder={fieldPlaceholder} value={incidentDraft.substances} onChangeText={(v) => setIncidentDraft({ ...incidentDraft, substances: v })} />
          <Field label={t('incident.threats')} placeholder={fieldPlaceholder} value={incidentDraft.threats} onChangeText={(v) => setIncidentDraft({ ...incidentDraft, threats: v })} multiline />
          <Toggle label={t('incident.childrenPresent')} value={incidentDraft.childrenPresent} onPress={() => setIncidentDraft({ ...incidentDraft, childrenPresent: !incidentDraft.childrenPresent })} />
          <Toggle label={t('incident.policeOrEms')} value={incidentDraft.policeOrEms} onPress={() => setIncidentDraft({ ...incidentDraft, policeOrEms: !incidentDraft.policeOrEms })} />
          <Toggle label={t('incident.boundaryCrossed')} value={incidentDraft.boundaryCrossed} onPress={() => setIncidentDraft({ ...incidentDraft, boundaryCrossed: !incidentDraft.boundaryCrossed })} />
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={addIncident}>
            <Text style={styles.primaryBtnText}>{t('incident.save')}</Text>
          </TouchableOpacity>
          {incidents.slice(0, 3).map((i) => (
            <View key={i.id} style={[styles.incident, { borderColor: colors.line }]}>
              <Text style={[styles.incidentDate, { color: colors.inkSoft }]}>{new Date(i.createdAt).toLocaleString()}</Text>
              <Text style={[styles.body, { color: colors.ink }]}>{i.summary}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('builder.title')}</Text>
          <Field label={t('builder.behavior')} placeholder={fieldPlaceholder} value={boundary.behavior} onChangeText={(v) => setBoundary({ ...boundary, behavior: v })} />
          <Field label={t('builder.support')} placeholder={fieldPlaceholder} value={boundary.support} onChangeText={(v) => setBoundary({ ...boundary, support: v })} />
          <Field label={t('builder.noLongerDo')} placeholder={fieldPlaceholder} value={boundary.noLongerDo} onChangeText={(v) => setBoundary({ ...boundary, noLongerDo: v })} />
          <Field label={t('builder.consequence')} placeholder={fieldPlaceholder} value={boundary.consequence} onChangeText={(v) => setBoundary({ ...boundary, consequence: v })} />
          <View style={[styles.scriptBox, { backgroundColor: colors.secondaryLight }]}>
            <Text style={[styles.script, { color: colors.ink }]}>{boundaryText}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('readiness.title')}</Text>
          <Text style={[styles.score, { color: colors.primary }]}>{t('readiness.ready', { score })}</Text>
          {READINESS_KEYS.map((key) => (
            <Toggle
              key={key}
              label={t(`readiness.${key}`)}
              value={readiness[key]}
              onPress={() => setReadiness((prev) => ({ ...prev, [key]: !prev[key] }))}
            />
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('support.title')}</Text>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={() => router.push('/chat')}>
            <Text style={styles.primaryBtnText}>{t('support.openTextline')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={() => void handleVideo()} disabled={requesting}>
            <Text style={[styles.outlineBtnText, { color: colors.primary }]}>{requesting ? t('support.requesting') : t('support.requestVideo')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.secondary }]} onPress={() => void shareSummary()}>
            <Text style={[styles.outlineBtnText, { color: colors.secondary }]}>{t('support.share')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.dangerBtn, { borderColor: colors.coral }]} onPress={() => Linking.openURL('tel:911')}>
            <Text style={[styles.outlineBtnText, { color: colors.coral }]}>{t('support.call911')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.dangerBtn, { borderColor: colors.coral }]} onPress={() => Linking.openURL('tel:988')}>
            <Text style={[styles.outlineBtnText, { color: colors.coral }]}>{t('support.call988')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMulti]}
        placeholder={placeholder}
        placeholderTextColor="#8a9695"
      />
    </View>
  );
}

function Toggle({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.toggleRow} onPress={onPress}>
      <View style={[styles.toggleBox, value && styles.toggleBoxOn]}>
        <Text style={styles.toggleMark}>{value ? '✓' : ''}</Text>
      </View>
      <Text style={styles.toggleText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  wrap: { padding: 18, paddingBottom: 40 },
  back: { fontSize: 16, fontWeight: '800', marginBottom: 12 },
  hero: { borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 14 },
  kicker: { fontSize: 12, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 20, flex: 1 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '900', marginBottom: 12 },
  checkRow: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', gap: 10, alignItems: 'center' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  boxText: { color: '#fff', fontWeight: '900' },
  checkText: { fontSize: 14, lineHeight: 19, flex: 1, fontWeight: '600' },
  riskCard: { borderRadius: 18, padding: 18, marginTop: 14 },
  riskKicker: { color: '#fff', opacity: 0.82, fontSize: 11, letterSpacing: 1, fontWeight: '900' },
  riskLevel: { color: '#fff', fontSize: 40, fontWeight: '900', marginTop: 2 },
  riskTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 6 },
  riskBody: { color: '#fff', fontSize: 14, lineHeight: 20 },
  riskAction: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '900', marginTop: 8 },
  stepRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  stepNum: { fontSize: 16, fontWeight: '900', width: 22 },
  scriptBox: { borderRadius: 14, padding: 14, marginTop: 6 },
  script: { fontSize: 16, lineHeight: 23, fontWeight: '800' },
  fieldWrap: { marginBottom: 12 },
  fieldLabel: { color: '#5c6b6a', fontSize: 12, fontWeight: '800', marginBottom: 5, textTransform: 'uppercase' },
  input: { backgroundColor: '#fff', borderColor: '#e2e0d8', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#22302f', fontSize: 15 },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 7 },
  toggleBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: '#e2e0d8', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  toggleBoxOn: { backgroundColor: '#1a365d', borderColor: '#1a365d' },
  toggleMark: { color: '#fff', fontWeight: '900' },
  toggleText: { color: '#22302f', fontSize: 14, lineHeight: 19, flex: 1, fontWeight: '600' },
  primaryBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  outlineBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  dangerBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  outlineBtnText: { fontWeight: '900', fontSize: 15 },
  incident: { borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  incidentDate: { fontSize: 12, fontWeight: '800', marginBottom: 4 },
  score: { fontSize: 32, fontWeight: '900', marginBottom: 8 },
});
