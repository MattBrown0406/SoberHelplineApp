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
import { PremierVideoSchedulingCard } from '../src/components/video/PremierVideoSchedulingCard';
import { PlanReviewBookingCard } from '../src/components/video/PlanReviewBookingCard';
import {
  CRISIS_SITUATION_ORDER,
  assessSituationRisk,
  getCrisisSituations,
  type CrisisSituationKey,
} from '../src/content/crisisCopilot';

type RiskLevel = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
type Stage = 'situation' | 'safety' | 'result';
type TriageKey =
  | 'notBreathing' | 'overdose' | 'suicide' | 'violence' | 'weapons'
  | 'childrenPresent' | 'drivingIntoxicated' | 'missing' | 'intoxicated'
  | 'aggressive' | 'askingMoney' | 'willingTalk';

type Incident = {
  id: string; createdAt: string; summary: string; substances: string; threats: string;
  childrenPresent: boolean; policeOrEms: boolean; boundaryCrossed: boolean;
};

type SafetyPlan = {
  lovedOneName: string; substances: string; overdoseHistory: string; suicideHistory: string;
  weaponsAccess: string; childrenInHome: string; emergencyContacts: string;
  preferredHospital: string; insurance: string; currentBoundaries: string; decisionMakers: string;
};

type BoundaryDraft = { behavior: string; support: string; noLongerDo: string; consequence: string };
type CommandPlan = { coordinator: string; communicator: string; safetyLead: string; unifiedStatement: string };

const TRIAGE: { key: TriageKey; red?: boolean; orange?: boolean }[] = [
  { key: 'notBreathing', red: true }, { key: 'overdose', red: true },
  { key: 'suicide', red: true }, { key: 'violence', red: true },
  { key: 'weapons', red: true }, { key: 'drivingIntoxicated', red: true },
  { key: 'childrenPresent', orange: true }, { key: 'missing', orange: true },
  { key: 'intoxicated', orange: true }, { key: 'aggressive', orange: true },
  { key: 'askingMoney', orange: true }, { key: 'willingTalk' },
];

const DEFAULT_PLAN: SafetyPlan = {
  lovedOneName: '', substances: '', overdoseHistory: '', suicideHistory: '', weaponsAccess: '',
  childrenInHome: '', emergencyContacts: '', preferredHospital: '', insurance: '',
  currentBoundaries: '', decisionMakers: '',
};
const DEFAULT_BOUNDARY: BoundaryDraft = { behavior: '', support: '', noLongerDo: '', consequence: '' };
const DEFAULT_COMMAND: CommandPlan = { coordinator: '', communicator: '', safetyLead: '', unifiedStatement: '' };
const PLAN_FIELDS: (keyof SafetyPlan)[] = [
  'lovedOneName', 'substances', 'overdoseHistory', 'suicideHistory', 'weaponsAccess',
  'childrenInHome', 'emergencyContacts', 'preferredHospital', 'insurance',
  'currentBoundaries', 'decisionMakers',
];
const PLAN_MULTILINE = new Set<keyof SafetyPlan>(['emergencyContacts', 'currentBoundaries']);

function emptyTriage() {
  return TRIAGE.reduce((acc, q) => ({ ...acc, [q.key]: false }), {} as Record<TriageKey, boolean>);
}

function preselectedForSituation(situation: CrisisSituationKey): Record<TriageKey, boolean> {
  const selected = emptyTriage();
  const mapped: Partial<Record<CrisisSituationKey, TriageKey>> = {
    overdose: 'overdose', selfHarm: 'suicide', violence: 'violence', driving: 'drivingIntoxicated',
    missing: 'missing', demands: 'askingMoney', familyConflict: 'aggressive',
  };
  const key = mapped[situation];
  if (key) selected[key] = true;
  return selected;
}

function crisisStorageKey(userId: string, suffix: string) {
  return `soberhelpline:crisis:${userId}:${suffix}`;
}

function parseStoredRecord<T extends object>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const safe = { ...fallback } as Record<string, unknown>;
    const candidate = value as Record<string, unknown>;
    for (const [key, defaultValue] of Object.entries(fallback)) {
      if (typeof candidate[key] === typeof defaultValue) safe[key] = candidate[key];
    }
    return safe as T;
  } catch { return fallback; }
}

function parseStoredIncidents(raw: string | null): Incident[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is Incident => !!item && typeof item === 'object' && typeof item.summary === 'string' && typeof item.createdAt === 'string')
      : [];
  } catch { return []; }
}

function levelColor(level: RiskLevel) {
  if (level === 'RED') return '#b42318';
  if (level === 'ORANGE') return '#c4604f';
  if (level === 'YELLOW') return '#d9913b';
  return '#4d7c5f';
}

function riskLevel(situation: CrisisSituationKey | null, selected: Record<TriageKey, boolean>): RiskLevel {
  const immediateDanger = TRIAGE.some((q) => q.red && selected[q.key]);
  const activeConcernCount = TRIAGE.filter((q) => q.orange && selected[q.key]).length;
  return assessSituationRisk(situation, immediateDanger, activeConcernCount);
}

function emergencyChecklistKey(situation: CrisisSituationKey | null, selected: Record<TriageKey, boolean>) {
  if (situation === 'overdose' || selected.notBreathing || selected.overdose) return 'redOverdose';
  if (situation === 'selfHarm' || selected.suicide) return 'redSuicide';
  return 'redDefault';
}

function buildBoundary(draft: BoundaryDraft, t: TFunction<'crisis'>) {
  return t('builder.template', {
    behavior: draft.behavior.trim() || t('builder.defaults.behavior'),
    support: draft.support.trim() || t('builder.defaults.support'),
    noLongerDo: draft.noLongerDo.trim() || t('builder.defaults.noLongerDo'),
    consequence: draft.consequence.trim() || t('builder.defaults.consequence'),
  });
}

export default function CrisisModeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('crisis');
  const { user, accountState, entitlements } = useAccount();
  const isSpanish = i18n.language.toLowerCase().startsWith('es');
  const situations = useMemo(() => getCrisisSituations(i18n.language), [i18n.language]);
  const hasEssential = !!user && accountState !== 'direct-free';
  const hasPremium = accountState === 'direct-premium' || accountState === 'attached';
  const canAccessPrivateVideo = !!user && entitlements.canAccessPrivateVideo;
  const privateVideo = usePrivateVideoSessions(user?.id ?? null, hasEssential);

  const [stage, setStage] = useState<Stage>('situation');
  const [situationKey, setSituationKey] = useState<CrisisSituationKey | null>(null);
  const [selected, setSelected] = useState<Record<TriageKey, boolean>>(emptyTriage);
  const [plan, setPlan] = useState<SafetyPlan>(DEFAULT_PLAN);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentDraft, setIncidentDraft] = useState<Omit<Incident, 'id' | 'createdAt'>>({
    summary: '', substances: '', threats: '', childrenPresent: false, policeOrEms: false, boundaryCrossed: false,
  });
  const [boundary, setBoundary] = useState<BoundaryDraft>(DEFAULT_BOUNDARY);
  const [command, setCommand] = useState<CommandPlan>(DEFAULT_COMMAND);
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(null);

  const level = useMemo(() => riskLevel(situationKey, selected), [selected, situationKey]);
  const situation = situationKey ? situations[situationKey] : null;
  const immediateActions = level === 'RED'
    ? t(`checklist.${emergencyChecklistKey(situationKey, selected)}`, { returnObjects: true }) as string[]
    : situation?.action ?? [];
  const sayThis = level === 'RED' ? t('say.red') : situation?.say ?? t('say.default');
  const dontDo = situation?.dont ?? [];
  const boundaryText = buildBoundary(boundary, t);
  const fieldPlaceholder = t('field.placeholder');
  const planReviewSource = useMemo(() => ({
    situation: { key: situationKey, label: situation?.label ?? null },
    risk: { level, selected },
    safetyPlan: plan,
    boundaries: { ...boundary, rendered: boundaryText },
    incidents,
    familyRoles: command,
  }), [boundary, boundaryText, command, incidents, level, plan, selected, situation?.label, situationKey]);

  useEffect(() => {
    setHydratedUserId(null);
    if (!hasEssential || !user) {
      setPlan(DEFAULT_PLAN); setIncidents([]); setBoundary(DEFAULT_BOUNDARY); setCommand(DEFAULT_COMMAND);
      return;
    }
    const userId = user.id;
    let cancelled = false;
    async function load() {
      const [planRaw, incidentsRaw, boundaryRaw, commandRaw] = await Promise.all([
        AsyncStorage.getItem(crisisStorageKey(userId, 'plan')),
        AsyncStorage.getItem(crisisStorageKey(userId, 'incidents')),
        AsyncStorage.getItem(crisisStorageKey(userId, 'boundary')),
        AsyncStorage.getItem(crisisStorageKey(userId, 'command')),
      ]);
      if (cancelled) return;
      setPlan(parseStoredRecord(planRaw, DEFAULT_PLAN));
      setIncidents(parseStoredIncidents(incidentsRaw));
      setBoundary(parseStoredRecord(boundaryRaw, DEFAULT_BOUNDARY));
      setCommand(parseStoredRecord(commandRaw, DEFAULT_COMMAND));
      setHydratedUserId(userId);
    }
    void load();
    return () => { cancelled = true; };
  }, [hasEssential, user]);

  useEffect(() => {
    if (hasEssential && user && hydratedUserId === user.id) void AsyncStorage.setItem(crisisStorageKey(user.id, 'plan'), JSON.stringify(plan));
  }, [hasEssential, hydratedUserId, plan, user]);
  useEffect(() => {
    if (hasEssential && user && hydratedUserId === user.id) void AsyncStorage.setItem(crisisStorageKey(user.id, 'incidents'), JSON.stringify(incidents));
  }, [hasEssential, hydratedUserId, incidents, user]);
  useEffect(() => {
    if (hasEssential && user && hydratedUserId === user.id) void AsyncStorage.setItem(crisisStorageKey(user.id, 'boundary'), JSON.stringify(boundary));
  }, [boundary, hasEssential, hydratedUserId, user]);
  useEffect(() => {
    if (hasPremium && user && hydratedUserId === user.id) void AsyncStorage.setItem(crisisStorageKey(user.id, 'command'), JSON.stringify(command));
  }, [command, hasPremium, hydratedUserId, user]);

  function chooseSituation(key: CrisisSituationKey) {
    setSituationKey(key);
    setSelected(preselectedForSituation(key));
    setStage('safety');
  }

  function toggle(key: TriageKey) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function startOver() {
    setSituationKey(null); setSelected(emptyTriage()); setStage('situation');
  }

  function clearSavedData() {
    if (!user) return;
    Alert.alert(
      isSpanish ? '¿Borrar datos de crisis guardados?' : 'Clear saved crisis data?',
      isSpanish ? 'Esto elimina de este dispositivo el plan, incidentes, límites y roles guardados para esta cuenta.' : 'This removes this account’s saved plan, incidents, boundaries, and roles from this device.',
      [
        { text: isSpanish ? 'Cancelar' : 'Cancel', style: 'cancel' },
        { text: isSpanish ? 'Borrar' : 'Clear', style: 'destructive', onPress: () => {
          void Promise.all(['plan', 'incidents', 'boundary', 'command'].map((suffix) => AsyncStorage.removeItem(crisisStorageKey(user.id, suffix))));
          setPlan(DEFAULT_PLAN); setIncidents([]); setBoundary(DEFAULT_BOUNDARY); setCommand(DEFAULT_COMMAND);
        } },
      ],
    );
  }

  function addIncident() {
    if (!hasEssential) { showUpgrade('Essential'); return; }
    if (!incidentDraft.summary.trim()) {
      Alert.alert(t('incident.alertTitle'), t('incident.alertBody')); return;
    }
    const next: Incident = { ...incidentDraft, id: `${Date.now()}`, createdAt: new Date().toISOString() };
    setIncidents((prev) => [next, ...prev].slice(0, 25));
    setIncidentDraft({ summary: '', substances: '', threats: '', childrenPresent: false, policeOrEms: false, boundaryCrossed: false });
  }

  function showUpgrade(tier: 'Essential' | 'Premium') {
    Alert.alert(
      isSpanish ? `${tier} requerido` : `${tier} required`,
      tier === 'Essential'
        ? (isSpanish ? 'Guarda planes, incidentes y seguimiento de 24/72 horas con Essential.' : 'Save plans, incidents, and 24/72-hour follow-up with Essential.')
        : (isSpanish ? 'El Plan de Comando Familiar está incluido con Premium.' : 'The Family Command Plan is included with Premium.'),
      [
        { text: isSpanish ? 'Ahora no' : 'Not now', style: 'cancel' },
        { text: isSpanish ? 'Ver planes' : 'View plans', onPress: () => router.push('/(tabs)/support' as never) },
      ],
    );
  }

  async function shareSummary(includeCommand = false) {
    if (!hasEssential || !situation) { showUpgrade('Essential'); return; }
    const recent = incidents.slice(0, 5).map((i) => `- ${new Date(i.createdAt).toLocaleString()}: ${i.summary}`).join('\n') || t('share.noIncidents');
    const message = [
      t('share.heading'), '', `${t('share.riskLevel')}: ${level}`, situation.label, '',
      isSpanish ? 'HACER AHORA' : 'DO NOW', ...immediateActions.map((item) => `• ${item}`), '',
      isSpanish ? 'DECIR ESTO' : 'SAY THIS', sayThis, '',
      isSpanish ? 'NO HACER' : "DON'T DO THIS", ...dontDo.map((item) => `• ${item}`), '',
      isSpanish ? 'PRÓXIMAS 24 HORAS' : 'NEXT 24 HOURS', ...situation.next24.map((item) => `• ${item}`), '',
      isSpanish ? 'PRÓXIMAS 72 HORAS' : 'NEXT 72 HOURS', ...situation.next72.map((item) => `• ${item}`), '',
      t('share.boundary'), boundaryText, '', t('share.recent'), recent,
      ...(includeCommand && hasPremium ? ['', isSpanish ? 'PLAN DE COMANDO FAMILIAR' : 'FAMILY COMMAND PLAN',
        `${isSpanish ? 'Coordinador' : 'Coordinator'}: ${command.coordinator || '—'}`,
        `${isSpanish ? 'Comunicador' : 'Communicator'}: ${command.communicator || '—'}`,
        `${isSpanish ? 'Responsable de seguridad' : 'Safety lead'}: ${command.safetyLead || '—'}`,
        command.unifiedStatement || '—'] : []),
      '', t('share.note'),
    ].join('\n');
    await Share.share({ title: t('share.title'), message });
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.cream }]}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
        </TouchableOpacity>

        <View style={[styles.hero, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.kicker, { color: colors.coral }]}>{isSpanish ? 'COPILOTO DE CRISIS' : 'CRISIS COPILOT'}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>
            {isSpanish ? 'Respira. No tienes que resolver toda la adicción esta noche. Vamos a decidir el próximo paso seguro.' : 'Take one breath. You do not have to solve the entire addiction tonight. We will decide the next safe step.'}
          </Text>
          <View style={styles.progressRow} accessibilityLabel={`${stage} step`}>
            {(['situation', 'safety', 'result'] as Stage[]).map((item, index) => (
              <View key={item} style={[styles.progressDot, { backgroundColor: item === stage ? colors.primary : colors.line }]}>
                <Text style={styles.progressText}>{index + 1}</Text>
              </View>
            ))}
          </View>
        </View>

        <EmergencyActions colors={colors} isSpanish={isSpanish} />

        {stage === 'situation' && (
          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>{isSpanish ? '¿Qué está pasando ahora?' : 'What is happening right now?'}</Text>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{isSpanish ? 'Elige la opción más cercana. Podrás agregar detalles de seguridad después.' : 'Choose the closest situation. You can add safety details next.'}</Text>
            {CRISIS_SITUATION_ORDER.map((key) => (
              <TouchableOpacity key={key} style={[styles.situationRow, { borderColor: colors.line }]} onPress={() => chooseSituation(key)} accessibilityRole="button">
                <View style={styles.flexOne}>
                  <Text style={[styles.situationTitle, { color: colors.ink }]}>{situations[key].label}</Text>
                  <Text style={[styles.small, { color: colors.inkSoft }]}>{situations[key].description}</Text>
                </View>
                <Text style={[styles.chevron, { color: colors.primary }]}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {stage === 'safety' && situation && (
          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.coral }]}>{situation.label}</Text>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>{isSpanish ? '¿Qué más es cierto?' : 'What else is true?'}</Text>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('intro')}</Text>
            {TRIAGE.map((q) => (
              <TouchableOpacity key={q.key} style={[styles.checkRow, { borderColor: selected[q.key] ? levelColor(level) : colors.line }]} onPress={() => toggle(q.key)} accessibilityRole="checkbox" accessibilityState={{ checked: selected[q.key] }}>
                <View style={[styles.box, { backgroundColor: selected[q.key] ? levelColor(level) : colors.white, borderColor: selected[q.key] ? levelColor(level) : colors.line }]}>
                  <Text style={styles.boxText}>{selected[q.key] ? '✓' : ''}</Text>
                </View>
                <Text style={[styles.checkText, { color: colors.ink }]}>{t(`triage.items.${q.key}`)}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity accessibilityRole="button" style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={() => setStage('result')}>
              <Text style={styles.primaryBtnText}>{isSpanish ? 'Muéstrame qué hacer' : 'Show me what to do'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textBtn} onPress={() => setStage('situation')}>
              <Text style={[styles.textBtnText, { color: colors.primary }]}>{isSpanish ? 'Elegir otra situación' : 'Choose a different situation'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'result' && situation && (
          <>
            <View style={[styles.riskCard, { backgroundColor: levelColor(level) }]} accessibilityLiveRegion="polite">
              <Text style={styles.riskKicker}>{t('risk.kicker').toUpperCase()}</Text>
              <Text style={styles.riskLevel}>{level}</Text>
              <Text style={styles.riskTitle}>{t(`risk.${level}.title`)}</Text>
              <Text style={styles.riskBody}>{t(`risk.${level}.body`)}</Text>
            </View>

            <ActionCard title={isSpanish ? 'Haz esto ahora' : 'Do this now'} items={immediateActions} colors={colors} numbered />
            <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>{isSpanish ? 'Di esto' : 'Say this'}</Text>
              <View style={[styles.scriptBox, { backgroundColor: colors.primaryLight }]}><Text style={[styles.script, { color: colors.ink }]}>{sayThis}</Text></View>
            </View>
            <ActionCard title={isSpanish ? 'No hagas esto' : "Don't do this"} items={dontDo} colors={colors} />

            {level === 'RED' && <EmergencyActions colors={colors} isSpanish={isSpanish} prominent />}

            <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={startOver}>
              <Text style={[styles.outlineBtnText, { color: colors.primary }]}>{isSpanish ? 'Iniciar una nueva evaluación' : 'Start a new assessment'}</Text>
            </TouchableOpacity>

            {hasEssential ? (
              <>
                <View style={[styles.tierBanner, { backgroundColor: colors.secondaryLight }]}>
                  <Text style={[styles.tierTitle, { color: colors.ink }]}>{isSpanish ? 'Herramientas Essential desbloqueadas' : 'Essential tools unlocked'}</Text>
                  <Text style={[styles.small, { color: colors.inkSoft }]}>{isSpanish ? 'Se guarda en este dispositivo para esta cuenta. Evita usar un dispositivo compartido.' : 'Saved on this device for this account. Avoid using a shared device.'}</Text>
                </View>
                <ActionCard title={isSpanish ? 'Plan para las próximas 24 horas' : 'Next 24-hour plan'} items={situation.next24} colors={colors} numbered />
                <ActionCard title={isSpanish ? 'Plan para las próximas 72 horas' : 'Next 72-hour plan'} items={situation.next72} colors={colors} numbered />

                <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
                  <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('plan.title')}</Text>
                  {PLAN_FIELDS.map((key) => <Field key={key} label={t(`plan.${key}`)} placeholder={fieldPlaceholder} value={plan[key]} onChangeText={(value) => setPlan((prev) => ({ ...prev, [key]: value }))} multiline={PLAN_MULTILINE.has(key)} />)}
                </View>

                <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
                  <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('incident.title')}</Text>
                  <Field label={t('incident.what')} placeholder={fieldPlaceholder} value={incidentDraft.summary} onChangeText={(summary) => setIncidentDraft((prev) => ({ ...prev, summary }))} multiline />
                  <Field label={t('incident.substances')} placeholder={fieldPlaceholder} value={incidentDraft.substances} onChangeText={(substances) => setIncidentDraft((prev) => ({ ...prev, substances }))} />
                  <Field label={t('incident.threats')} placeholder={fieldPlaceholder} value={incidentDraft.threats} onChangeText={(threats) => setIncidentDraft((prev) => ({ ...prev, threats }))} multiline />
                  <Toggle label={t('incident.childrenPresent')} value={incidentDraft.childrenPresent} onPress={() => setIncidentDraft((prev) => ({ ...prev, childrenPresent: !prev.childrenPresent }))} />
                  <Toggle label={t('incident.policeOrEms')} value={incidentDraft.policeOrEms} onPress={() => setIncidentDraft((prev) => ({ ...prev, policeOrEms: !prev.policeOrEms }))} />
                  <Toggle label={t('incident.boundaryCrossed')} value={incidentDraft.boundaryCrossed} onPress={() => setIncidentDraft((prev) => ({ ...prev, boundaryCrossed: !prev.boundaryCrossed }))} />
                  <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={addIncident}><Text style={styles.primaryBtnText}>{t('incident.save')}</Text></TouchableOpacity>
                  {incidents.slice(0, 5).map((incident) => <View key={incident.id} style={[styles.incident, { borderColor: colors.line }]}><Text style={[styles.incidentDate, { color: colors.inkSoft }]}>{new Date(incident.createdAt).toLocaleString()}</Text><Text style={[styles.body, { color: colors.ink }]}>{incident.summary}</Text></View>)}
                </View>

                <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
                  <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('builder.title')}</Text>
                  <Field label={t('builder.behavior')} placeholder={fieldPlaceholder} value={boundary.behavior} onChangeText={(value) => setBoundary((prev) => ({ ...prev, behavior: value }))} />
                  <Field label={t('builder.support')} placeholder={fieldPlaceholder} value={boundary.support} onChangeText={(value) => setBoundary((prev) => ({ ...prev, support: value }))} />
                  <Field label={t('builder.noLongerDo')} placeholder={fieldPlaceholder} value={boundary.noLongerDo} onChangeText={(value) => setBoundary((prev) => ({ ...prev, noLongerDo: value }))} />
                  <Field label={t('builder.consequence')} placeholder={fieldPlaceholder} value={boundary.consequence} onChangeText={(value) => setBoundary((prev) => ({ ...prev, consequence: value }))} />
                  <View style={[styles.scriptBox, { backgroundColor: colors.secondaryLight }]}><Text style={[styles.script, { color: colors.ink }]}>{boundaryText}</Text></View>
                </View>
                <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.secondary }]} onPress={() => void shareSummary()}><Text style={[styles.outlineBtnText, { color: colors.secondary }]}>{t('support.share')}</Text></TouchableOpacity>
                <TouchableOpacity style={styles.textBtn} onPress={clearSavedData}><Text style={[styles.textBtnText, { color: colors.coral }]}>{isSpanish ? 'Borrar datos de crisis guardados' : 'Clear saved crisis data'}</Text></TouchableOpacity>
              </>
            ) : (
              <LockedCard tier="Essential" cta={isSpanish ? 'Ver Essential' : 'View Essential'} title={isSpanish ? 'Guarda el plan y continúa después' : 'Save the plan and continue later'} body={isSpanish ? 'Essential incluye planes de 24/72 horas, registro de incidentes, límites y resumen compartible.' : 'Essential includes 24/72-hour plans, incident history, boundaries, and a shareable summary.'} colors={colors} onPress={() => showUpgrade('Essential')} />
            )}

            {hasPremium ? (
              <View style={[styles.card, styles.premiumCard, { backgroundColor: colors.ink, borderColor: colors.primary }]}>
                <Text style={styles.premiumEyebrow}>PREMIUM</Text>
                <Text style={styles.premiumTitle}>{isSpanish ? 'Plan de Comando Familiar' : 'Family Command Plan'}</Text>
                <Text style={styles.premiumBody}>{isSpanish ? 'Asigna roles y comparte una sola posición familiar. Esta versión crea un plan privado; la sala multiusuario en vivo llegará después.' : 'Assign roles and share one unified family position. This version creates a private command plan; a live multi-user room comes later.'}</Text>
                <Field dark label={isSpanish ? 'Coordinador de la crisis' : 'Crisis coordinator'} placeholder={fieldPlaceholder} value={command.coordinator} onChangeText={(value) => setCommand((prev) => ({ ...prev, coordinator: value }))} />
                <Field dark label={isSpanish ? 'Única persona que comunica' : 'Single family communicator'} placeholder={fieldPlaceholder} value={command.communicator} onChangeText={(value) => setCommand((prev) => ({ ...prev, communicator: value }))} />
                <Field dark label={isSpanish ? 'Responsable de niños/seguridad' : 'Children and safety lead'} placeholder={fieldPlaceholder} value={command.safetyLead} onChangeText={(value) => setCommand((prev) => ({ ...prev, safetyLead: value }))} />
                <Field dark multiline label={isSpanish ? 'Posición familiar unificada' : 'Unified family statement'} placeholder={boundaryText} value={command.unifiedStatement} onChangeText={(value) => setCommand((prev) => ({ ...prev, unifiedStatement: value }))} />
                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={() => void shareSummary(true)}><Text style={styles.primaryBtnText}>{isSpanish ? 'Compartir plan de comando' : 'Share command plan'}</Text></TouchableOpacity>
              </View>
            ) : (
              <LockedCard tier="Premium" cta={isSpanish ? 'Ver Premium' : 'View Premium'} title={isSpanish ? 'Mantén a la familia alineada' : 'Keep the family aligned'} body={isSpanish ? 'Premium agrega roles, una posición unificada y apoyo por video privado.' : 'Premium adds role assignments, a unified family position, and private video support.'} colors={colors} onPress={() => showUpgrade('Premium')} />
            )}

            <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('support.title')}</Text>
              {entitlements.canMessageOnCallCoach ? <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={() => router.push('/chat')}><Text style={styles.primaryBtnText}>{t('support.openTextline')}</Text></TouchableOpacity> : <Text style={[styles.body, { color: colors.inkSoft }]}>{isSpanish ? 'El apoyo por texto está disponible con Essential y Premium. Para peligro inmediato, usa 911 o 988.' : 'Text support is available with Essential and Premium. For immediate danger, use 911 or 988.'}</Text>}
              {(canAccessPrivateVideo || privateVideo.activeSession?.appointment_type === 'one_off_150') ? <PremierVideoSchedulingCard controller={privateVideo} t={t} translationRoot="premierVideo" compact onJoin={(session) => router.push({ pathname: '/video-session' as never, params: { sessionId: session.id, room: session.room_name } })} /> : null}
              {hasEssential ? <PlanReviewBookingCard controller={privateVideo} accountState={accountState} source={planReviewSource} t={t} consentLocale={isSpanish ? 'es' : 'en'} onUpgrade={() => router.push('/(tabs)/support' as never)} /> : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function EmergencyActions({ colors, isSpanish, prominent = false }: { colors: ReturnType<typeof useTheme>['colors']; isSpanish: boolean; prominent?: boolean }) {
  return <View style={[styles.emergencyCard, { backgroundColor: prominent ? '#fff1ef' : colors.white, borderColor: colors.coral }]}>
    <Text style={[styles.emergencyTitle, { color: colors.coral }]}>{isSpanish ? '¿Hay peligro inmediato?' : 'Immediate danger?'}</Text>
    <Text style={[styles.small, { color: colors.inkSoft }]}>{isSpanish ? 'Estas acciones siempre son gratuitas.' : 'These actions are always free.'}</Text>
    <View style={styles.emergencyButtons}>
      <EmergencyButton label={isSpanish ? 'Llamar al 911 (EE. UU.)' : 'Call 911 (U.S.)'} onPress={() => Linking.openURL('tel:911')} color={colors.coral} />
      <EmergencyButton label={isSpanish ? 'Llamar al 988' : 'Call 988'} onPress={() => Linking.openURL('tel:988')} color={colors.primary} />
      <EmergencyButton label={isSpanish ? 'Enviar texto al 988' : 'Text 988'} onPress={() => Linking.openURL('sms:988')} color={colors.primary} />
      <EmergencyButton label={isSpanish ? 'Control de Envenenamiento EE. UU.' : 'U.S. Poison Control'} onPress={() => Linking.openURL('tel:18002221222')} color={colors.secondary} />
    </View>
  </View>;
}

function EmergencyButton({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return <TouchableOpacity style={[styles.emergencyBtn, { borderColor: color }]} onPress={onPress} accessibilityRole="button"><Text style={[styles.emergencyBtnText, { color }]}>{label}</Text></TouchableOpacity>;
}

function ActionCard({ title, items, colors, numbered = false }: { title: string; items: string[]; colors: ReturnType<typeof useTheme>['colors']; numbered?: boolean }) {
  return <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}><Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>{items.map((item, index) => <View key={`${index}-${item}`} style={styles.stepRow}><Text style={[styles.stepNum, { color: colors.primary }]}>{numbered ? index + 1 : '•'}</Text><Text style={[styles.body, styles.flexOne, { color: colors.ink }]}>{item}</Text></View>)}</View>;
}

function LockedCard({ tier, cta, title, body, colors, onPress }: { tier: string; cta: string; title: string; body: string; colors: ReturnType<typeof useTheme>['colors']; onPress: () => void }) {
  return <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}><Text style={[styles.lockBadge, { color: colors.primary }]}>{tier.toUpperCase()}</Text><Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text><Text style={[styles.body, { color: colors.inkSoft }]}>{body}</Text><TouchableOpacity accessibilityRole="button" style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={onPress}><Text style={styles.primaryBtnText}>{cta}</Text></TouchableOpacity></View>;
}

function Field({ label, value, onChangeText, placeholder, multiline = false, dark = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; dark?: boolean }) {
  return <View style={styles.fieldWrap}><Text style={[styles.fieldLabel, dark && styles.darkLabel]}>{label}</Text><TextInput value={value} onChangeText={onChangeText} multiline={multiline} style={[styles.input, multiline && styles.inputMulti, dark && styles.darkInput]} placeholder={placeholder} placeholderTextColor={dark ? '#9fb0ae' : '#8a9695'} accessibilityLabel={label} /></View>;
}

function Toggle({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return <TouchableOpacity style={styles.toggleRow} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: value }}><View style={[styles.toggleBox, value && styles.toggleBoxOn]}><Text style={styles.toggleMark}>{value ? '✓' : ''}</Text></View><Text style={styles.toggleText}>{label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, wrap: { padding: 18, paddingBottom: 60 }, flexOne: { flex: 1 },
  back: { fontSize: 16, fontWeight: '800', marginBottom: 12 },
  hero: { borderWidth: 1, borderRadius: 24, padding: 22, marginBottom: 14 },
  kicker: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontSize: 29, lineHeight: 35, fontWeight: '900', marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22 }, small: { fontSize: 13, lineHeight: 18 },
  progressRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  progressDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  progressText: { color: '#fff', fontWeight: '900' },
  card: { borderWidth: 1, borderRadius: 20, padding: 18, marginBottom: 14 },
  sectionTitle: { fontSize: 21, lineHeight: 26, fontWeight: '900', marginBottom: 10 },
  eyebrow: { fontSize: 12, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  situationRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 15, padding: 14, marginTop: 10 },
  situationTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800', marginBottom: 3 }, chevron: { fontSize: 28, marginLeft: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 9 },
  box: { width: 24, height: 24, borderWidth: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  boxText: { color: '#fff', fontWeight: '900' }, checkText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  riskCard: { borderRadius: 22, padding: 20, marginBottom: 14 }, riskKicker: { color: '#fff', opacity: 0.85, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  riskLevel: { color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 7 }, riskTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 5 }, riskBody: { color: '#fff', fontSize: 15, lineHeight: 21, marginTop: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 }, stepNum: { width: 28, fontSize: 16, fontWeight: '900' },
  scriptBox: { borderRadius: 14, padding: 15, marginTop: 5 }, script: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  primaryBtn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', marginTop: 14 }, primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  outlineBtn: { borderWidth: 1.5, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginBottom: 14 }, outlineBtnText: { fontSize: 15, fontWeight: '900' },
  textBtn: { padding: 12, alignItems: 'center' }, textBtnText: { fontSize: 14, fontWeight: '800' },
  emergencyCard: { borderWidth: 1.5, borderRadius: 18, padding: 15, marginBottom: 14 }, emergencyTitle: { fontSize: 17, fontWeight: '900', marginBottom: 3 },
  emergencyButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 }, emergencyBtn: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 }, emergencyBtnText: { fontSize: 13, fontWeight: '900' },
  tierBanner: { borderRadius: 16, padding: 15, marginBottom: 14 }, tierTitle: { fontSize: 16, fontWeight: '900', marginBottom: 4 }, lockBadge: { fontSize: 11, letterSpacing: 1.2, fontWeight: '900', marginBottom: 7 },
  fieldWrap: { marginTop: 12 }, fieldLabel: { color: '#203331', fontSize: 13, fontWeight: '800', marginBottom: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d4dfdd', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, color: '#203331', fontSize: 15 }, inputMulti: { minHeight: 82, textAlignVertical: 'top' },
  darkLabel: { color: '#d9e4e2' }, darkInput: { backgroundColor: '#263c39', borderColor: '#4e6864', color: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 }, toggleBox: { width: 24, height: 24, borderWidth: 1, borderColor: '#b8c8c5', borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginRight: 10 }, toggleBoxOn: { backgroundColor: '#1f8a70', borderColor: '#1f8a70' }, toggleMark: { color: '#fff', fontWeight: '900' }, toggleText: { color: '#203331', flex: 1, fontSize: 14, lineHeight: 20 },
  incident: { borderTopWidth: 1, paddingTop: 10, marginTop: 10 }, incidentDate: { fontSize: 11, marginBottom: 3 },
  premiumCard: { borderWidth: 1.5 }, premiumEyebrow: { color: '#79d4b5', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 }, premiumTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 6 }, premiumBody: { color: '#d9e4e2', fontSize: 14, lineHeight: 20, marginTop: 7 },
});
