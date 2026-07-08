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

const TRIAGE: { key: TriageKey; label: string; red?: boolean; orange?: boolean }[] = [
  { key: 'notBreathing', label: 'They are not breathing, unconscious, blue/gray, or cannot be woken up.', red: true },
  { key: 'overdose', label: 'I suspect overdose or poisoning.', red: true },
  { key: 'suicide', label: 'They are threatening suicide or serious self-harm.', red: true },
  { key: 'violence', label: 'They are threatening violence or someone may get hurt.', red: true },
  { key: 'weapons', label: 'Weapons are involved or weapon access is a concern.', red: true },
  { key: 'drivingIntoxicated', label: 'They are trying to drive while intoxicated.', red: true },
  { key: 'childrenPresent', label: 'Children are present or may be exposed to the crisis.', orange: true },
  { key: 'missing', label: 'They are missing or no one knows where they are.', orange: true },
  { key: 'intoxicated', label: 'They are intoxicated right now.', orange: true },
  { key: 'aggressive', label: 'They are verbally aggressive, escalating, or impossible to reason with.', orange: true },
  { key: 'askingMoney', label: 'They are pressuring the family for money, housing, keys, or a rescue.', orange: true },
  { key: 'willingTalk', label: 'They are sober enough and willing to talk calmly.' },
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

function crisisStorageKey(userId: string | null | undefined, suffix: string) {
  return `soberhelpline:crisis:${userId ?? 'guest'}:${suffix}`;
}

function levelColor(level: RiskLevel) {
  if (level === 'RED') return '#b42318';
  if (level === 'ORANGE') return '#c4604f';
  if (level === 'YELLOW') return '#d9913b';
  return '#4d7c5f';
}

function riskCopy(level: RiskLevel) {
  if (level === 'RED') {
    return {
      title: 'Immediate safety risk',
      body: 'This is not a coaching conversation. Move toward safety and contact emergency services now.',
      action: 'Call 911 or 988 now if there is immediate medical danger, violence, or suicide risk.',
    };
  }
  if (level === 'ORANGE') {
    return {
      title: 'Active crisis risk',
      body: 'Do not argue, debate treatment, or try to control the situation alone. Focus on safety, children, keys, distance, and calm next steps.',
      action: 'Use the checklist below, then use Emergency Text Line or request Premium video support when safe.',
    };
  }
  if (level === 'YELLOW') {
    return {
      title: 'Escalating concern',
      body: 'The pattern needs a clear family response. This is a good time to set a boundary, document what happened, and plan before the next escalation.',
      action: 'Build a boundary and update the incident log/safety plan.',
    };
  }
  return {
    title: 'Stable concern',
    body: 'There may not be immediate danger, but the family should still plan, align, and stop enabling patterns early.',
    action: 'Use education, readiness, and boundary tools before things escalate.',
  };
}

function checklistFor(level: RiskLevel, selected: Record<TriageKey, boolean>) {
  if (level === 'RED') {
    if (selected.notBreathing || selected.overdose) {
      return [
        'Call 911 now. Say overdose/poisoning is suspected if that is true.',
        'Give naloxone if available. Repeat per package instructions if needed.',
        'Start rescue breathing/CPR if trained and safe to do so.',
        'Put them in recovery position if breathing but unconscious.',
        'Stay until responders arrive. Tell responders what substances may be involved.',
      ];
    }
    if (selected.suicide) {
      return [
        'Call or text 988 now. Call 911 if there is immediate danger or means are present.',
        'Do not leave them alone if it is safe for you to stay nearby.',
        'Remove access to weapons, pills, or keys only if you can do it safely.',
        'Use short, calm statements. Do not debate, shame, or threaten.',
        'Bring in another safe adult immediately if possible.',
      ];
    }
    return [
      'Leave the area if violence/weapons are possible. Physical safety comes first.',
      'Call 911 from a safe place.',
      'Move children away from the scene immediately if you can do so safely.',
      'Do not physically block, restrain, or chase an intoxicated person.',
      'Document threats after everyone is safe.',
    ];
  }
  if (level === 'ORANGE') {
    return [
      'Stop arguing. No treatment debate while they are intoxicated or escalated.',
      'Move children, keys, cash, and medications to safety if you can do so calmly.',
      'Do not give money, rides to unsafe places, or access to the car.',
      'Use one short script. Repeat it. Do not over-explain.',
      'Log the incident once the immediate situation settles.',
    ];
  }
  return [
    'Name the pattern in writing without exaggerating or minimizing.',
    'Choose one boundary the family can actually keep.',
    'Decide who communicates. Too many voices creates chaos.',
    'Prepare treatment/support options before making big threats.',
    'Ask: am I helping recovery or reducing my own anxiety?',
  ];
}

function scriptFor(selected: Record<TriageKey, boolean>, level: RiskLevel) {
  if (level === 'RED') return '“I love you. Right now this is about safety. I’m calling for emergency help.”';
  if (selected.askingMoney) return '“I love you too much to give money while addiction is active. I will help you get real support, but I will not fund the addiction.”';
  if (selected.intoxicated || selected.aggressive) return '“I’m not going to argue while you’re intoxicated or escalated. I’ll talk when we can both stay safe and respectful.”';
  if (selected.willingTalk) return '“I love you. I’m willing to talk about real help and next steps. I’m not willing to keep pretending this is working.”';
  return '“I love you, and I’m changing how I respond. I will support recovery. I will not support the addiction.”';
}

function buildBoundary(draft: BoundaryDraft) {
  const behavior = draft.behavior.trim() || 'this pattern continues';
  const support = draft.support.trim() || 'getting real recovery support';
  const noLongerDo = draft.noLongerDo.trim() || 'give money, cover up consequences, or argue with addiction';
  const consequence = draft.consequence.trim() || 'I will step back, protect my peace, and contact help if safety becomes a concern';
  return `I love you and I want you healthy. When ${behavior}, I am not going to keep responding the old way. I will support ${support}. I will no longer ${noLongerDo}. If the boundary is crossed, ${consequence}.`;
}

function readinessScore(readiness: Readiness) {
  const values = Object.values(readiness);
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}

export default function CrisisModeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
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

  const copy = riskCopy(level);
  const checklist = checklistFor(level, selected);
  const script = scriptFor(selected, level);
  const boundaryText = buildBoundary(boundary);
  const score = readinessScore(readiness);

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
      Alert.alert('Incident log', 'Add a short summary before saving.');
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
      Alert.alert('Premium video support', 'Private video support is included with Premium. Upgrade from the Support tab.');
      return;
    }
    const session = activeSession ?? await requestSession();
    if (session?.status === 'live') {
      router.push({ pathname: '/video-session' as never, params: { room: session.room_name } });
    } else {
      Alert.alert('Request received', 'Your private video support request is in the admin queue. This is not an emergency service.');
    }
  }

  async function shareSummary() {
    const recent = incidents.slice(0, 5).map((i) => `- ${new Date(i.createdAt).toLocaleString()}: ${i.summary}`).join('\n') || '- No incidents logged yet.';
    const message = `Sober Helpline Family Crisis Summary\n\nRisk level: ${level}\n${copy.title}\n\nLoved one: ${plan.lovedOneName || 'Not entered'}\nSubstances: ${plan.substances || 'Not entered'}\nOverdose history: ${plan.overdoseHistory || 'Not entered'}\nSuicide/self-harm history: ${plan.suicideHistory || 'Not entered'}\nWeapons access: ${plan.weaponsAccess || 'Not entered'}\nChildren in home: ${plan.childrenInHome || 'Not entered'}\nEmergency contacts: ${plan.emergencyContacts || 'Not entered'}\nPreferred hospital: ${plan.preferredHospital || 'Not entered'}\nInsurance: ${plan.insurance || 'Not entered'}\nDecision makers: ${plan.decisionMakers || 'Not entered'}\n\nRecommended script:\n${script}\n\nCurrent boundary:\n${boundaryText}\n\nIntervention readiness: ${score}%\n\nRecent incidents:\n${recent}\n\nNote: This is family guidance, not medical, legal, or emergency-service replacement. Call 911/988 for immediate danger.`;
    await Share.share({ title: 'Sober Helpline Crisis Summary', message });
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.cream }]}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹ Back</Text>
        </TouchableOpacity>

        <View style={[styles.hero, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.kicker, { color: colors.coral }]}>CRISIS MODE</Text>
          <Text style={[styles.title, { color: colors.ink }]}>Help me know what to do right now</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>Answer what is true. This does not replace 911, 988, poison control, medical care, or law enforcement.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>1. Triage the situation</Text>
          {TRIAGE.map((q) => (
            <TouchableOpacity key={q.key} style={[styles.checkRow, { borderColor: selected[q.key] ? levelColor(level) : colors.line }]} onPress={() => toggle(q.key)}>
              <View style={[styles.box, { backgroundColor: selected[q.key] ? levelColor(level) : colors.white, borderColor: selected[q.key] ? levelColor(level) : colors.line }]}>
                <Text style={styles.boxText}>{selected[q.key] ? '✓' : ''}</Text>
              </View>
              <Text style={[styles.checkText, { color: colors.ink }]}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.riskCard, { backgroundColor: levelColor(level) }]}>
          <Text style={styles.riskKicker}>CURRENT RISK LEVEL</Text>
          <Text style={styles.riskLevel}>{level}</Text>
          <Text style={styles.riskTitle}>{copy.title}</Text>
          <Text style={styles.riskBody}>{copy.body}</Text>
          <Text style={styles.riskAction}>{copy.action}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>2. Checklist</Text>
          {checklist.map((item, index) => (
            <View key={item} style={styles.stepRow}>
              <Text style={[styles.stepNum, { color: colors.primary }]}>{index + 1}</Text>
              <Text style={[styles.body, { color: colors.ink }]}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>3. What to say right now</Text>
          <View style={[styles.scriptBox, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.script, { color: colors.ink }]}>{script}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>4. Family safety plan</Text>
          <Field label="Loved one name" value={plan.lovedOneName} onChangeText={(v) => setPlan({ ...plan, lovedOneName: v })} />
          <Field label="Substances involved" value={plan.substances} onChangeText={(v) => setPlan({ ...plan, substances: v })} />
          <Field label="Overdose history" value={plan.overdoseHistory} onChangeText={(v) => setPlan({ ...plan, overdoseHistory: v })} />
          <Field label="Suicide/self-harm history" value={plan.suicideHistory} onChangeText={(v) => setPlan({ ...plan, suicideHistory: v })} />
          <Field label="Weapons access" value={plan.weaponsAccess} onChangeText={(v) => setPlan({ ...plan, weaponsAccess: v })} />
          <Field label="Children in home" value={plan.childrenInHome} onChangeText={(v) => setPlan({ ...plan, childrenInHome: v })} />
          <Field label="Emergency contacts" value={plan.emergencyContacts} onChangeText={(v) => setPlan({ ...plan, emergencyContacts: v })} multiline />
          <Field label="Preferred hospital / detox" value={plan.preferredHospital} onChangeText={(v) => setPlan({ ...plan, preferredHospital: v })} />
          <Field label="Insurance / policy notes" value={plan.insurance} onChangeText={(v) => setPlan({ ...plan, insurance: v })} />
          <Field label="Current family boundaries" value={plan.currentBoundaries} onChangeText={(v) => setPlan({ ...plan, currentBoundaries: v })} multiline />
          <Field label="Family decision-makers" value={plan.decisionMakers} onChangeText={(v) => setPlan({ ...plan, decisionMakers: v })} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>5. Incident log</Text>
          <Field label="What happened?" value={incidentDraft.summary} onChangeText={(v) => setIncidentDraft({ ...incidentDraft, summary: v })} multiline />
          <Field label="Substances suspected" value={incidentDraft.substances} onChangeText={(v) => setIncidentDraft({ ...incidentDraft, substances: v })} />
          <Field label="Threats / safety concerns" value={incidentDraft.threats} onChangeText={(v) => setIncidentDraft({ ...incidentDraft, threats: v })} multiline />
          <Toggle label="Children were present" value={incidentDraft.childrenPresent} onPress={() => setIncidentDraft({ ...incidentDraft, childrenPresent: !incidentDraft.childrenPresent })} />
          <Toggle label="Police or EMS involved" value={incidentDraft.policeOrEms} onPress={() => setIncidentDraft({ ...incidentDraft, policeOrEms: !incidentDraft.policeOrEms })} />
          <Toggle label="A family boundary was crossed" value={incidentDraft.boundaryCrossed} onPress={() => setIncidentDraft({ ...incidentDraft, boundaryCrossed: !incidentDraft.boundaryCrossed })} />
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={addIncident}>
            <Text style={styles.primaryBtnText}>Save incident</Text>
          </TouchableOpacity>
          {incidents.slice(0, 3).map((i) => (
            <View key={i.id} style={[styles.incident, { borderColor: colors.line }]}> 
              <Text style={[styles.incidentDate, { color: colors.inkSoft }]}>{new Date(i.createdAt).toLocaleString()}</Text>
              <Text style={[styles.body, { color: colors.ink }]}>{i.summary}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>6. Boundary builder</Text>
          <Field label="Behavior that needs to stop" value={boundary.behavior} onChangeText={(v) => setBoundary({ ...boundary, behavior: v })} />
          <Field label="Support you are willing to offer" value={boundary.support} onChangeText={(v) => setBoundary({ ...boundary, support: v })} />
          <Field label="What you will no longer do" value={boundary.noLongerDo} onChangeText={(v) => setBoundary({ ...boundary, noLongerDo: v })} />
          <Field label="What happens if crossed" value={boundary.consequence} onChangeText={(v) => setBoundary({ ...boundary, consequence: v })} />
          <View style={[styles.scriptBox, { backgroundColor: colors.secondaryLight }]}>
            <Text style={[styles.script, { color: colors.ink }]}>{boundaryText}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>7. Intervention readiness</Text>
          <Text style={[styles.score, { color: colors.primary }]}>{score}% ready</Text>
          <Toggle label="Family is aligned" value={readiness.familyAligned} onPress={() => setReadiness({ ...readiness, familyAligned: !readiness.familyAligned })} />
          <Toggle label="Money/rescue patterns have stopped" value={readiness.moneyStopped} onPress={() => setReadiness({ ...readiness, moneyStopped: !readiness.moneyStopped })} />
          <Toggle label="Treatment option is ready" value={readiness.treatmentReady} onPress={() => setReadiness({ ...readiness, treatmentReady: !readiness.treatmentReady })} />
          <Toggle label="Transportation is planned" value={readiness.transportPlanned} onPress={() => setReadiness({ ...readiness, transportPlanned: !readiness.transportPlanned })} />
          <Toggle label="Consequences are clear and realistic" value={readiness.consequencesClear} onPress={() => setReadiness({ ...readiness, consequencesClear: !readiness.consequencesClear })} />
          <Toggle label="Refusal plan is ready" value={readiness.refusalPlan} onPress={() => setReadiness({ ...readiness, refusalPlan: !readiness.refusalPlan })} />
          <Toggle label="Yes plan is ready" value={readiness.yesPlan} onPress={() => setReadiness({ ...readiness, yesPlan: !readiness.yesPlan })} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>8. Get support</Text>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={() => router.push('/chat')}>
            <Text style={styles.primaryBtnText}>Open Emergency Text Line</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={() => void handleVideo()} disabled={requesting}>
            <Text style={[styles.outlineBtnText, { color: colors.primary }]}>{requesting ? 'Requesting…' : 'Request Premium Video Support'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.secondary }]} onPress={() => void shareSummary()}>
            <Text style={[styles.outlineBtnText, { color: colors.secondary }]}>Share / Export family crisis summary</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.dangerBtn, { borderColor: colors.coral }]} onPress={() => Linking.openURL('tel:911')}>
            <Text style={[styles.outlineBtnText, { color: colors.coral }]}>Call 911</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.dangerBtn, { borderColor: colors.coral }]} onPress={() => Linking.openURL('tel:988')}>
            <Text style={[styles.outlineBtnText, { color: colors.coral }]}>Call/Text 988</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMulti]}
        placeholder="Tap to enter"
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
