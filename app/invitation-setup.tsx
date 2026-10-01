import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { FreeTierPaywall } from '../src/components/ui/FreeTierPaywall';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useLovedOne } from '../src/hooks/useLovedOne';
import { useInvitationEngine } from '../src/hooks/useInvitationEngine';
import { registerForPushNotifications } from '../src/hooks/usePushNotifications';
import { ChipPicker } from '../src/components/invitation/ChipPicker';
import { SafetyFirstPanel } from '../src/components/invitation/SafetyFirstPanel';
import { StepProgress } from '../src/components/invitation/StepProgress';
import { BackLink, EngineCard, Kicker, PrimaryButton } from '../src/components/invitation/ui';
import {
  completeInvitationSetup,
  fetchLovedOneProfile,
  fetchRecentWarningSigns,
  saveLovedOneProfile,
} from '../src/lib/invitationApi';
import { localClock } from '../src/lib/invitationEngine';
import {
  commitPendingItem,
  createSerialQueue,
  LEAVE_SAVE_TIMEOUT_MS,
  prefillProfile,
  previousWeekStart,
  RELATIONSHIP_KEYS,
  settleWithin,
  setupSteps,
  STEP_FIELD,
  SUBSTANCE_KEYS,
  suggestionKeys,
  withListItems,
  type SetupStep,
} from '../src/lib/invitationSetup';
import {
  mergeSoberTimes,
  PROFILE_LIST_FIELDS,
  PROFILE_NAME_MAX,
  SAFETY_CONCERNS,
  SOBER_TIME_OPTIONS,
  type LovedOneProfile,
  type ProfileListField,
} from '../src/lib/lovedOneProfile';
import { captureAppError } from '../src/lib/monitoring';

/**
 * The pattern map: a calm, one-question-per-screen CRAFT functional analysis
 * in the family's own words. Free for every member (the engine's hook); the
 * final "alerts" step is paid and never offered on the safety-first path.
 */
export default function InvitationSetupScreen() {
  const { user } = useAccount();
  return <InvitationSetupContent key={user?.id ?? 'signed-out'} />;
}

const STEP_TO_REVIEW_FIELD: Record<ProfileListField, SetupStep> = {
  useTriggers: 'triggers',
  whatUseGives: 'gives',
  costsTheyFeel: 'costs',
  soberMoments: 'sober',
  usualPhrases: 'phrases',
  recentIncidents: 'incidents',
};

function InvitationSetupContent() {
  const { user } = useAccount();
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const router = useRouter();
  const params = useLocalSearchParams<{ step?: string }>();
  const accountId = user?.id ?? null;
  // The saved map is loaded here, not through useLovedOneProfile, so a failed
  // load blocks the flow behind a retry instead of looking like "no map yet"
  // (a draft rebuilt from nothing would otherwise save over the real one).
  const [saved, setSaved] = useState<{ state: 'loading' | 'ready' | 'error'; profile: LovedOneProfile | null }>({
    state: 'loading',
    profile: null,
  });
  const loadRequest = useRef(0);
  const loadSaved = useCallback(async () => {
    const id = ++loadRequest.current;
    if (!accountId) {
      setSaved({ state: 'ready', profile: null });
      return;
    }
    setSaved({ state: 'loading', profile: null });
    try {
      const profile = await fetchLovedOneProfile(accountId);
      if (id === loadRequest.current) setSaved({ state: 'ready', profile });
    } catch (error) {
      captureAppError(error);
      if (id === loadRequest.current) setSaved({ state: 'error', profile: null });
    }
  }, [accountId]);
  useEffect(() => {
    void loadSaved();
    return () => { loadRequest.current += 1; };
  }, [loadSaved]);
  const profile = saved.profile;
  const { lovedOne, loading: lovedOneLoading } = useLovedOne(accountId);
  const engine = useInvitationEngine(accountId, user?.timezone);

  const [draft, setDraft] = useState<LovedOneProfile | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [warningSigns, setWarningSigns] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [safetyMissing, setSafetyMissing] = useState(false);
  const [finished, setFinished] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);
  const [noDevice, setNoDevice] = useState(false);
  const dirty = useRef(false);
  const initialized = useRef(false);
  const timesTouched = useRef(false);
  // Every save goes through one queue, in order: the instant save of her
  // safety answer can never land after (and undo) a later Next save.
  const saveQueue = useRef<ReturnType<typeof createSerialQueue> | null>(null);
  if (!saveQueue.current) saveQueue.current = createSerialQueue();
  const navigation = useNavigation();
  // Read by the leave/back handlers, which outlive any one render.
  const draftRef = useRef<LovedOneProfile | null>(null);
  draftRef.current = draft;
  const leaving = useRef(false);
  const [leavingBusy, setLeavingBusy] = useState(false);
  // Words typed into this step's list but not yet Added (lifted out of the
  // picker so moving on or leaving can fold them into THIS step's list).
  const [pendingItem, setPendingItemState] = useState('');
  const pendingRef = useRef('');
  function setPendingItem(text: string) {
    pendingRef.current = text;
    setPendingItemState(text);
  }

  // Her own answer only; a relative's answer never changes her flow.
  const safetySerious = draft?.safetyConcern === 'serious';
  const steps = useMemo(
    () => setupSteps({ paid: engine.hasAccess, safetySerious }),
    [engine.hasAccess, safetySerious],
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  // Start from the saved map, prefilled from the loved-one record.
  useEffect(() => {
    if (initialized.current || saved.state !== 'ready' || lovedOneLoading || engine.loading) return;
    initialized.current = true;
    setDraft(prefillProfile(profile, lovedOne));
    setAlertsOn(engine.snapshot?.state.windowPushOptIn ?? false);
    const requested = typeof params.step === 'string' ? params.step : '';
    const target = steps.indexOf(requested as SetupStep);
    if (target >= 0 && profile?.completedAt) setStepIndex(target);
  }, [engine.loading, engine.snapshot, lovedOne, lovedOneLoading, params.step, profile, saved.state, steps]);

  // Seed suggestion chips from this week's and last week's tracker warning signs.
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    const since = previousWeekStart(localClock(new Date(), user?.timezone).date);
    fetchRecentWarningSigns(accountId, since)
      .then((signs) => { if (active) setWarningSigns(signs); })
      .catch(captureAppError);
    return () => { active = false; };
  }, [accountId, user?.timezone]);

  function update(patch: Partial<LovedOneProfile>) {
    dirty.current = true;
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function changeList(listField: ProfileListField, items: string[]) {
    dirty.current = true;
    setDraft((current) => (current ? withListItems(current, listField, items, timesTouched.current) : current));
  }

  /**
   * Fold any typed-but-not-Added words into the current step's list (before
   * Next, Previous, Back or leaving) and return the profile to save — never
   * a stale render's copy.
   */
  function commitPending(): LovedOneProfile | null {
    const current = draftRef.current;
    const text = pendingRef.current;
    if (text) setPendingItem('');
    if (!current) return null;
    const next = commitPendingItem(current, STEP_FIELD[step], text, timesTouched.current);
    if (!next) return current;
    dirty.current = true;
    draftRef.current = next;
    setDraft(next);
    return next;
  }

  /** Queue one save of exactly this profile; resolves true when it landed. */
  function enqueueSave(profile: LovedOneProfile, complete: boolean): Promise<boolean> {
    return saveQueue.current!(async () => {
      try {
        const saved = await saveLovedOneProfile(profile, complete);
        setDraft((current) => (current ? { ...current, completedAt: saved.completedAt, updatedAt: saved.updatedAt } : current));
        return true;
      } catch (error) {
        captureAppError(error);
        setSaveError(true);
        return false;
      }
    });
  }

  async function persist(profile: LovedOneProfile, complete: boolean): Promise<boolean> {
    setSaving(true);
    setSaveError(false);
    try {
      const ok = await enqueueSave(profile, complete);
      if (ok) dirty.current = false;
      return ok;
    } finally {
      setSaving(false);
    }
  }

  /**
   * Her safety answer is saved the moment she picks it: leaving setup (back,
   * Android back, the app closing during a hotline call) must never lose a
   * 'some' or 'serious'.
   */
  function chooseSafety(concern: LovedOneProfile['safetyConcern']) {
    if (!draft) return;
    setSafetyMissing(false);
    setSaveError(false);
    const next = { ...draft, safetyConcern: concern };
    dirty.current = true;
    setDraft(next);
    void enqueueSave(next, false);
  }

  /** Save anything typed since the last save (or wait for queued saves). */
  function flushPending(): Promise<boolean> {
    const current = draftRef.current;
    if (current && dirty.current) return enqueueSave(current, false);
    return saveQueue.current!(async () => true);
  }

  /**
   * The only way out of setup while it is open: save first (bounded), then
   * pop THIS screen — navigation.goBack() is bound to it, and is skipped if
   * the screen already left — so a second back press can never pop the kit.
   * The iOS swipe-back gesture is off for this screen (gestureEnabled: false
   * below) and Android's back button is routed here.
   */
  async function leaveSetup() {
    if (leaving.current) return;
    leaving.current = true;
    setLeavingBusy(true);
    try {
      commitPending();
      // Wait for her edits to land (bounded), so the screen she returns to —
      // e.g. the kit after "Edit your map" — reads the saved map.
      await settleWithin(flushPending(), LEAVE_SAVE_TIMEOUT_MS);
      if (navigation.isFocused()) navigation.goBack();
    } finally {
      // Always re-armed: if the screen lost focus while saving (no pop), a
      // later Back still works. A second press after the pop is a no-op —
      // the isFocused() check above, and the back handler is gone on blur.
      leaving.current = false;
      setLeavingBusy(false);
    }
  }
  const leaveRef = useRef(leaveSetup);
  leaveRef.current = leaveSetup;

  // Android hardware back: same path as the Back link. While leaving, swallow
  // further presses; with nothing unsaved, let the system handle it.
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (leaving.current) return true;
      if (!dirty.current && !pendingRef.current.trim()) return false;
      void leaveRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []));

  async function next() {
    if (!draft || saving) return;
    const current = commitPending() ?? draft;
    if (step === 'safety' && !current.safetyConcern) {
      setSafetyMissing(true);
      return;
    }
    setSafetyMissing(false);
    if (step === 'review') {
      // A finished map always carries a safety answer (the server enforces it too).
      if (!current.safetyConcern) {
        setStepIndex(steps.indexOf('safety'));
        setSafetyMissing(true);
        return;
      }
      if (!(await persist(current, true))) return;
      const alertsIndex = steps.indexOf('alerts');
      if (alertsIndex >= 0) {
        setStepIndex(alertsIndex);
        return;
      }
      // Paid members on the safety-first path are set up without alerts.
      if (engine.hasAccess) await completeInvitationSetup(false).catch(captureAppError);
      setFinished(true);
      return;
    }
    if (step === 'alerts') {
      await finishWithAlerts();
      return;
    }
    // Save as we go; a failed draft save never blocks the next question.
    if (step !== 'intro' && dirty.current) await persist(current, false);
    // Anything typed while that save was in flight still belongs to THIS
    // step's list (saved on the next Next or on leaving), never the next one.
    commitPending();
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }

  async function finishWithAlerts() {
    if (!accountId) return;
    setSaving(true);
    setSaveError(false);
    try {
      if (alertsOn && Platform.OS !== 'web') {
        const registered = await registerForPushNotifications(accountId).catch(() => false);
        setNoDevice(!registered);
      }
      await completeInvitationSetup(alertsOn);
      // Return to an engine screen already in the stack instead of stacking another.
      router.dismissTo('/invitation-engine' as never);
    } catch (error) {
      captureAppError(error);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function back() {
    if (stepIndex === 0) {
      void leaveSetup();
      return;
    }
    // Kept in this step's list (saved on the next Next or on leaving).
    commitPending();
    setStepIndex((index) => Math.max(0, index - 1));
  }

  if (saved.state === 'error') {
    return (
      <ScreenContainer contentContainerStyle={styles.wrap}>
        <BackLink label={t('common.back')} onPress={() => router.back()} />
        <EngineCard tone="alert">
          <Text accessibilityRole="alert" style={[styles.title, { color: colors.coral }]}>{t('setup.loadErrorTitle')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('setup.loadErrorBody')}</Text>
          <PrimaryButton label={t('common.retry')} onPress={() => { void loadSaved(); }} />
        </EngineCard>
      </ScreenContainer>
    );
  }

  if (!draft) {
    return (
      <ScreenContainer>
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
      </ScreenContainer>
    );
  }

  if (finished) {
    return (
      <ScreenContainer contentContainerStyle={styles.wrap}>
        <EngineCard tone="calm">
          <Kicker>{t('setup.kicker')}</Kicker>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('setup.doneTitle')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('setup.doneBody')}</Text>
          <PrimaryButton label={t('setup.openEngine')} onPress={() => router.dismissTo('/invitation-engine' as never)} />
        </EngineCard>
        {safetySerious && <SafetyFirstPanel />}
        {!engine.hasAccess && <FreeTierPaywall inline />}
      </ScreenContainer>
    );
  }

  const field = STEP_FIELD[step];
  const primaryLabel = step === 'intro'
    ? t('setup.intro.start')
    : step === 'review'
      ? t('setup.review.save')
      : step === 'alerts'
        ? t('setup.alerts.finish')
        : t('common.next');

  return (
    <ScreenContainer keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrap}>
      {/* No swipe-back while setup is open: leaving always goes through leaveSetup. */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      <BackLink
        label={leavingBusy ? t('common.saving') : t('common.back')}
        busy={leavingBusy}
        onPress={() => { void leaveSetup(); }}
      />
      <Kicker>{t('setup.kicker')}</Kicker>
      <StepProgress step={stepIndex + 1} total={steps.length} />

      {step === 'intro' && (
        <View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('setup.intro.title')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('setup.intro.body')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('setup.intro.note')}</Text>
          <Text style={[styles.privacy, { color: colors.inkSoft }]}>{t('setup.privacy')}</Text>
        </View>
      )}

      {step === 'basics' && (
        <View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('setup.basics.title')}</Text>
          <Text style={[styles.label, { color: colors.ink }]}>{t('setup.basics.nameLabel')}</Text>
          <TextInput
            accessibilityLabel={t('setup.basics.nameLabel')}
            value={draft.name}
            onChangeText={(name) => update({ name })}
            placeholder={t('setup.basics.namePlaceholder')}
            placeholderTextColor={colors.inkSoft}
            maxLength={PROFILE_NAME_MAX}
            autoCapitalize="words"
            style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.white }]}
          />
          <Text style={[styles.label, { color: colors.ink }]}>{t('setup.basics.relationshipLabel')}</Text>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {RELATIONSHIP_KEYS.map((key) => (
              <Choice
                key={key}
                role="radio"
                label={t(`onboarding:lovedOne.relationship.${key}`)}
                selected={draft.relationship === key}
                onPress={() => update({ relationship: draft.relationship === key ? '' : key })}
              />
            ))}
          </View>
          <Text style={[styles.label, { color: colors.ink }]}>{t('setup.basics.substancesLabel')}</Text>
          <View style={styles.chips}>
            {SUBSTANCE_KEYS.map((key) => {
              const selected = draft.substances.includes(key);
              return (
                <Choice
                  key={key}
                  role="checkbox"
                  label={t(`onboarding:lovedOne.substances.${key}`)}
                  selected={selected}
                  onPress={() => update({
                    substances: selected ? draft.substances.filter((item) => item !== key) : [...draft.substances, key],
                  })}
                />
              );
            })}
          </View>
        </View>
      )}

      {step === 'safety' && (
        <View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('setup.safety.title')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('setup.safety.body')}</Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {SAFETY_CONCERNS.map((concern) => {
              const selected = draft.safetyConcern === concern;
              return (
                <TouchableOpacity
                  key={concern}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${t(`setup.safety.${concern}`)}. ${t(`setup.safety.${concern}Body`)}`}
                  onPress={() => chooseSafety(concern)}
                  style={[
                    styles.option,
                    {
                      borderColor: selected ? (concern === 'serious' ? colors.coral : colors.primary) : colors.line,
                      backgroundColor: selected ? (concern === 'serious' ? colors.coralLight : colors.primaryLight) : colors.white,
                    },
                  ]}
                >
                  <Text style={[styles.optionTitle, { color: colors.ink }]}>{t(`setup.safety.${concern}`)}</Text>
                  <Text style={[styles.optionBody, { color: colors.inkSoft }]}>{t(`setup.safety.${concern}Body`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {safetyMissing && (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('setup.safety.required')}</Text>
          )}
          {draft.safetyConcern === 'some' && (
            <Text style={[styles.body, { color: colors.ink }]}>{t('setup.safety.someNote')}</Text>
          )}
          {draft.safetyConcern === 'serious' && (
            <>
              <Text style={[styles.body, { color: colors.ink }]}>{t('setup.safety.seriousNote')}</Text>
              <SafetyFirstPanel />
            </>
          )}
        </View>
      )}

      {field && (
        <View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t(`setup.${step}.title`)}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t(`setup.${step}.body`)}</Text>
          <ChipPicker
            // A fresh picker per step: nothing typed on one list shows up in the next.
            key={step}
            items={draft[field]}
            onChange={(items) => changeList(field, items)}
            draftText={pendingItem}
            onDraftChange={setPendingItem}
            // No typing while the step is being saved or setup is closing.
            inputDisabled={saving || leavingBusy}
            suggestions={suggestionKeys(field, warningSigns).map(({ key, fromTracker }) => ({
              label: t(`setup.suggestions.${field}.${key}`),
              fromTracker,
            }))}
            placeholder={step === 'incidents' ? t('setup.incidents.placeholder') : undefined}
          />
          {step === 'sober' && (
            <>
              <Text style={[styles.label, { color: colors.ink }]}>{t('setup.sober.timesLabel')}</Text>
              <View style={styles.chips}>
                {SOBER_TIME_OPTIONS.map((time) => {
                  const times = draft.soberTimes ?? [];
                  const selected = times.includes(time);
                  return (
                    <Choice
                      key={time}
                      role="checkbox"
                      label={t(`setup.sober.times.${time}`)}
                      selected={selected}
                      onPress={() => {
                        timesTouched.current = true;
                        update({
                          soberTimes: selected ? times.filter((item) => item !== time) : mergeSoberTimes(times, [time]),
                        });
                      }}
                    />
                  );
                })}
              </View>
            </>
          )}
          <Text style={[styles.privacy, { color: colors.inkSoft }]}>{t('setup.skipHint')}</Text>
        </View>
      )}

      {step === 'review' && (
        <View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('setup.review.title')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('setup.review.body')}</Text>
          <ReviewRow
            label={t('setup.basics.title')}
            value={[
              draft.name,
              draft.relationship ? t(`onboarding:lovedOne.relationship.${draft.relationship}`) : '',
              ...draft.substances.map((key) => t(`onboarding:lovedOne.substances.${key}`)),
            ].filter(Boolean).join(' · ')}
            empty={t('setup.review.empty')}
            editLabel={t('setup.review.edit')}
            onEdit={() => setStepIndex(steps.indexOf('basics'))}
          />
          <ReviewRow
            label={t('setup.review.safetyLabel')}
            value={draft.safetyConcern ? t(`setup.safety.${draft.safetyConcern}`) : ''}
            empty={t('setup.review.empty')}
            editLabel={t('setup.review.edit')}
            onEdit={() => setStepIndex(steps.indexOf('safety'))}
          />
          {PROFILE_LIST_FIELDS.map((listField) => {
            const listStep = STEP_TO_REVIEW_FIELD[listField];
            return (
              <ReviewRow
                key={listField}
                label={t(`setup.${listStep}.title`)}
                value={draft[listField].join(' · ')}
                empty={t('setup.review.empty')}
                editLabel={t('setup.review.edit')}
                onEdit={() => setStepIndex(steps.indexOf(listStep))}
              />
            );
          })}
          {(draft.soberTimes ?? []).length > 0 && (
            <ReviewRow
              label={t('setup.review.timesLabel')}
              value={(draft.soberTimes ?? []).map((time) => t(`setup.sober.times.${time}`)).join(' · ')}
              empty={t('setup.review.empty')}
              editLabel={t('setup.review.edit')}
              onEdit={() => setStepIndex(steps.indexOf('sober'))}
            />
          )}
        </View>
      )}

      {step === 'alerts' && (
        <View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('setup.alerts.title')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('setup.alerts.body')}</Text>
          <View style={[styles.switchRow, { borderColor: colors.line, backgroundColor: colors.white }]}>
            <Text style={[styles.switchLabel, { color: colors.ink }]}>{t('setup.alerts.toggle')}</Text>
            <Switch
              accessibilityLabel={t('setup.alerts.toggle')}
              value={alertsOn}
              disabled={saving}
              onValueChange={setAlertsOn}
              trackColor={{ true: colors.green, false: colors.line }}
            />
          </View>
          {noDevice && <Text style={[styles.privacy, { color: colors.inkSoft }]}>{t('engine.alertsNoDevice')}</Text>}
        </View>
      )}

      {saveError && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('setup.saveError')}</Text>
      )}

      <PrimaryButton label={saving ? t('common.saving') : primaryLabel} busy={saving} onPress={() => { void next(); }} />
      {stepIndex > 0 && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.previous')} onPress={back} style={styles.previous}>
          <Text style={[styles.previousText, { color: colors.primary }]}>{t('common.previous')}</Text>
        </TouchableOpacity>
      )}
    </ScreenContainer>
  );
}

function Choice({
  label,
  selected,
  onPress,
  role,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role: 'radio' | 'checkbox';
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={role === 'radio' ? { selected } : { checked: selected }}
      onPress={onPress}
      style={[
        styles.choice,
        {
          borderColor: selected ? colors.primary : colors.line,
          backgroundColor: selected ? colors.primaryLight : colors.white,
        },
      ]}
    >
      <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ReviewRow({
  label,
  value,
  empty,
  editLabel,
  onEdit,
}: {
  label: string;
  value: string;
  empty: string;
  editLabel: string;
  onEdit: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.reviewRow, { borderBottomColor: colors.line }]}>
      <View style={styles.reviewText}>
        <Text style={[styles.reviewLabel, { color: colors.inkSoft }]}>{label}</Text>
        <Text style={[styles.reviewValue, { color: value ? colors.ink : colors.inkSoft }]}>{value || empty}</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${editLabel}: ${label}`} onPress={onEdit} style={styles.reviewEdit}>
        <Text style={[styles.reviewEditText, { color: colors.primary }]}>{editLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 64 },
  loading: { paddingVertical: 48 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 4 },
  body: { fontSize: 15, lineHeight: 22, marginTop: 8 },
  privacy: { fontSize: 12.5, lineHeight: 18, marginTop: 12 },
  label: { fontSize: 14, fontWeight: '800', marginTop: 18 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  choice: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, minHeight: 42, justifyContent: 'center' },
  choiceText: { fontSize: 14, fontWeight: '700' },
  options: { gap: 10, marginTop: 14 },
  option: { borderWidth: 1.5, borderRadius: 14, padding: 14, minHeight: 56 },
  optionTitle: { fontSize: 16, fontWeight: '800' },
  optionBody: { fontSize: 13.5, lineHeight: 19, marginTop: 3 },
  error: { fontSize: 13, fontWeight: '700', marginTop: 10 },
  reviewRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  reviewText: { flex: 1 },
  reviewLabel: { fontSize: 12, fontWeight: '800' },
  reviewValue: { fontSize: 14.5, lineHeight: 21, marginTop: 3 },
  reviewEdit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  reviewEditText: { fontSize: 13.5, fontWeight: '800' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
    gap: 12,
  },
  switchLabel: { flex: 1, fontSize: 15, fontWeight: '800' },
  previous: { alignItems: 'center', minHeight: 44, justifyContent: 'center', marginTop: 6 },
  previousText: { fontSize: 14, fontWeight: '800' },
});
