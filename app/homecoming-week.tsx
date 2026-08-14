import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useHomecomingWeek } from '../src/hooks/useHomecomingWeek';
import {
  canHomecomingItemBeNotApplicable,
  dischargeReadiness,
  homecomingFitKey,
  homecomingHousingOptions,
  homecomingProgress,
  HOMECOMING_ITEMS,
  isHomecomingItemComplete,
  type HomecomingItemDefinition,
  type HomecomingStatus,
} from '../src/lib/homecomingWeek';

type Controller = ReturnType<typeof useHomecomingWeek>;
type ChoiceOption = { value: string; label: string };

export default function HomecomingWeekScreen() {
  const router = useRouter();
  const { t } = useTranslation('homecomingWeek');
  const { colors } = useTheme();
  const { user } = useAccount();
  const controller = useHomecomingWeek(user?.id ?? null);
  const { plan, loadState, saveState, reload, retrySave, clear } = controller;
  const discharge = useMemo(() => dischargeReadiness(plan), [plan]);
  const progress = useMemo(() => homecomingProgress(plan), [plan]);
  const savedReady = progress.ready && saveState === 'saved';

  const confirmClear = () => Alert.alert(t('clearTitle'), t('clearBody'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('clearConfirm'), style: 'destructive', onPress: () => void clear().catch(() => undefined) },
  ]);

  return (
    <ScreenContainer scroll contentContainerStyle={styles.screen}>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}>
        <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
      </TouchableOpacity>
      <Text style={[styles.kicker, { color: colors.coral }]}>{t('kicker')}</Text>
      <Text style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
      <Text style={[styles.intro, { color: colors.inkSoft }]}>{t('intro')}</Text>
      <Text style={[styles.privacy, { color: colors.primary }]}>{t('privacy')}</Text>

      {loadState === 'loading' ? (
        <>
          <SafetyExceptions />
          <View style={[styles.stateCard, { borderColor: colors.line, backgroundColor: colors.white }]}>
            <ActivityIndicator accessibilityRole="progressbar" color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.ink }]}>{t('loading')}</Text>
          </View>
        </>
      ) : loadState === 'error' ? (
        <>
          <SafetyExceptions />
          <View accessibilityRole="alert" style={[styles.stateCard, { borderColor: colors.coral, backgroundColor: colors.coralLight }]}>
            <Text style={[styles.stateTitle, { color: colors.coral }]}>{t('loadErrorTitle')}</Text>
            <Text style={[styles.stateBody, { color: colors.ink }]}>{t('loadErrorBody')}</Text>
            <ActionButton label={t('retry')} onPress={() => void reload()} />
            <ActionButton label={t('startOver')} destructive onPress={confirmClear} />
          </View>
        </>
      ) : (
        <>
          <SafetyExceptions />
          <View accessibilityRole="summary" style={[styles.progressCard, { borderColor: savedReady ? colors.green : colors.coral, backgroundColor: colors.white }]}>
            <Text style={[styles.progressKicker, { color: savedReady ? colors.green : colors.coral }]}>{t('progressTitle')}</Text>
            <Text style={[styles.progressTitle, { color: savedReady ? colors.green : colors.coral }]}>
              {savedReady ? t('readyTitle') : t('notReadyTitle')}
            </Text>
            <Text style={[styles.progressBody, { color: colors.inkSoft }]}>
              {savedReady ? t('readyBody') : t('notReadyBody')}
            </Text>
            <Text style={[styles.count, { color: colors.ink }]}>{t('progressCount', { completed: progress.completed, total: progress.total })}</Text>
            {!discharge.ready && <Text style={[styles.missing, { color: colors.coral }]}>{t('dischargeMissing', { count: discharge.missing.length })}</Text>}
            <View style={[styles.track, { backgroundColor: colors.line }]}>
              <View style={[styles.fill, { width: `${progress.percentage}%`, backgroundColor: savedReady ? colors.green : colors.coral }]} />
            </View>
            <Text style={[styles.saveText, { color: saveState === 'error' ? colors.coral : colors.inkSoft }]}>
              {saveState === 'saving' ? t('saveSaving') : saveState === 'error' ? t('saveError') : t('saveSaved')}
            </Text>
            {saveState === 'error' && <ActionButton label={t('retrySave')} onPress={retrySave} />}
          </View>

          <IdentitySection controller={controller} />
          <DischargeSection controller={controller} housingBlocked={discharge.housingBlocked} />

          <Section title={t('sectionWeek')} hint={t('requiredHint')}>
            {(['day0', 'days1_3', 'days4_7'] as const).map((category) => (
              <View key={category}>
                <Text style={[styles.category, { color: colors.primary }]}>{t(`categories.${category}`)}</Text>
                {HOMECOMING_ITEMS.filter((item) => item.category === category).map((definition) => (
                  <ItemCard key={definition.id} controller={controller} definition={definition} />
                ))}
              </View>
            ))}
          </Section>

          <Text style={[styles.footer, { color: colors.inkSoft }]}>{t('footer')}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={confirmClear} style={styles.clearButton}>
            <Text style={[styles.clearText, { color: colors.coral }]}>{t('startOver')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScreenContainer>
  );
}

function SafetyExceptions() {
  const { t } = useTranslation('homecomingWeek');
  const { colors } = useTheme();
  return (
    <View style={styles.safetyStack}>
      <View accessibilityRole="alert" style={[styles.safetyCard, { borderColor: colors.coral, backgroundColor: colors.coralLight }]}>
        <Text style={[styles.safetyTitle, { color: colors.coral }]}>{t('safety.emergencyTitle')}</Text>
        <Text style={[styles.safetyBody, { color: colors.ink }]}>{t('safety.emergencyBody')}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => void Linking.openURL('tel:911')}>
          <Text style={[styles.safetyLink, { color: colors.coral }]}>{t('safety.call911')}</Text>
        </TouchableOpacity>
      </View>
      <View accessibilityRole="alert" style={[styles.safetyCard, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.safetyTitle, { color: colors.primary }]}>{t('safety.crisisTitle')}</Text>
        <Text style={[styles.safetyBody, { color: colors.ink }]}>{t('safety.crisisBody')}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => void Linking.openURL('tel:988')}>
          <Text style={[styles.safetyLink, { color: colors.primary }]}>{t('safety.call988')}</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.safetyCard, { borderColor: colors.green, backgroundColor: colors.greenLight }]}>
        <Text style={[styles.safetyTitle, { color: colors.green }]}>{t('safety.helpTitle')}</Text>
        <Text style={[styles.safetyBody, { color: colors.ink }]}>{t('safety.helpBody')}</Text>
      </View>
    </View>
  );
}

function IdentitySection({ controller }: { controller: Controller }) {
  const { t } = useTranslation('homecomingWeek');
  const { colors } = useTheme();
  const { identity } = controller.plan;
  const fit = homecomingFitKey(controller.plan);
  return (
    <Section title={t('sectionIdentity')} hint={t('requiredHint')}>
      <Field label={t('identity.preferredName')} placeholder={t('identity.preferredNamePlaceholder')} value={identity.preferredName} onChange={(preferredName) => controller.updateIdentity({ preferredName })} />
      <Text style={[styles.label, { color: colors.ink }]}>{t('identity.ageBand')}</Text>
      <Choices value={identity.ageBand} options={[
        { value: 'under_18', label: t('identity.under18') }, { value: 'adult', label: t('identity.adult') },
      ]} onChange={(ageBand) => controller.updateIdentity({ ageBand: ageBand as typeof identity.ageBand })} />
      <Field label={t('identity.exactAge')} placeholder={t('identity.exactAgePlaceholder')} keyboardType="number-pad" value={identity.exactAge} onChange={(exactAge) => controller.updateIdentity({ exactAge })} />
      <Text style={[styles.label, { color: colors.ink }]}>{t('identity.gender')}</Text>
      <Choices value={identity.gender} options={[
        { value: 'woman', label: t('identity.woman') }, { value: 'man', label: t('identity.man') },
        { value: 'nonbinary', label: t('identity.nonbinary') }, { value: 'prefer_not_to_say', label: t('identity.preferNot') },
      ]} onChange={(gender) => controller.updateIdentity({ gender: gender as typeof identity.gender })} />
      <Text style={[styles.hint, { color: colors.inkSoft }]}>{t('identity.genderRule')}</Text>
      {identity.ageBand && identity.gender && (
        <View style={[styles.fitCard, { borderColor: colors.secondary, backgroundColor: colors.white }]}>
          <Text style={[styles.fitText, { color: colors.ink }]}>{t(`fit.${fit}`)}</Text>
        </View>
      )}
    </Section>
  );
}

function DischargeSection({ controller, housingBlocked }: { controller: Controller; housingBlocked: boolean }) {
  const { t } = useTranslation('homecomingWeek');
  const { colors } = useTheme();
  const { plan, updateDischarge } = controller;
  const d = plan.discharge;
  const housingOptions = homecomingHousingOptions(plan).filter(Boolean);
  const adult = plan.identity.ageBand === 'adult';
  const setAdultControl = () => {
    const next = !d.adultReturnHomeConfirmed;
    updateDischarge({
      adultReturnHomeConfirmed: next,
      ...(!next ? { adultReturnHomeQuote: '', adultReturnHomeQuoteAffirmed: false, housingType: d.housingType === 'family_home' ? '' : d.housingType } : {}),
    });
  };
  return (
    <>
      <Section title={t('sectionDischarge')} hint={t('requiredHint')}>
        <Field label={t('discharge.facilityName')} placeholder={t('discharge.facilityPlaceholder')} value={d.facilityName} onChange={(facilityName) => updateDischarge({ facilityName })} />
        <Field label={t('discharge.dischargeDate')} placeholder={t('discharge.datePlaceholder')} value={d.dischargeDate} onChange={(dischargeDate) => updateDischarge({ dischargeDate })} />
        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.level')}</Text>
        <Choices value={d.level} options={['detox', 'residential', 'php', 'iop', 'outpatient', 'other'].map((value) => ({ value, label: t(`discharge.levels.${value}`) }))} onChange={(level) => updateDischarge({ level: level as typeof d.level })} />
        {d.level === 'other' && <Field label={t('discharge.levelOther')} value={d.levelOther} onChange={(levelOther) => updateDischarge({ levelOther })} />}
      </Section>

      <Section title={t('sectionHousing')} hint={t('requiredHint')}>
        {adult && (
          <>
            <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: d.adultReturnHomeConfirmed }} onPress={setAdultControl} style={[styles.checkRow, { borderColor: d.adultReturnHomeConfirmed ? colors.primary : colors.line }]}>
              <View style={[styles.checkbox, { backgroundColor: d.adultReturnHomeConfirmed ? colors.primary : colors.white, borderColor: colors.primary }]}>
                {d.adultReturnHomeConfirmed && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.checkLabel, { color: colors.ink }]}>{t('discharge.adultControl')}</Text>
            </TouchableOpacity>
            <Text style={[styles.hint, { color: colors.inkSoft }]}>{t('discharge.adultControlHint')}</Text>
            {d.adultReturnHomeConfirmed && <>
              <Field multiline label={t('discharge.adultQuote')} value={d.adultReturnHomeQuote} onChange={(adultReturnHomeQuote) => updateDischarge({ adultReturnHomeQuote, adultReturnHomeQuoteAffirmed: false })} />
              {!!d.adultReturnHomeQuote.trim() && (
                <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: d.adultReturnHomeQuoteAffirmed }} onPress={() => updateDischarge({ adultReturnHomeQuoteAffirmed: !d.adultReturnHomeQuoteAffirmed })} style={[styles.checkRow, { borderColor: d.adultReturnHomeQuoteAffirmed ? colors.primary : colors.line }]}>
                  <View style={[styles.checkbox, { backgroundColor: d.adultReturnHomeQuoteAffirmed ? colors.primary : colors.white, borderColor: colors.primary }]}>
                    {d.adultReturnHomeQuoteAffirmed && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.checkLabel, { color: colors.ink }]}>{t('discharge.adultQuoteAffirm')}</Text>
                </TouchableOpacity>
              )}
            </>}
          </>
        )}
        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.housingType')}</Text>
        <Choices value={d.housingType} options={housingOptions.map((value) => ({ value, label: t(`discharge.housing.${value}`) }))} onChange={(housingType) => updateDischarge({ housingType: housingType as typeof d.housingType })} />
        {plan.identity.ageBand === 'adult' && !!d.housingType && <>
          <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.otherHousingFamilyQuestion')}</Text>
          <Choices value={d.otherHousingFamilyStatus} options={[
            { value: 'family_or_relative', label: t('discharge.otherHousingFamily') },
            { value: 'not_family', label: t('discharge.otherHousingNotFamily') },
          ]} onChange={(otherHousingFamilyStatus) => updateDischarge({ otherHousingFamilyStatus: otherHousingFamilyStatus as typeof d.otherHousingFamilyStatus })} />
          <Text style={[styles.hint, { color: colors.inkSoft }]}>{t('discharge.otherHousingFamilyHint')}</Text>
        </>}
        <Field multiline label={t('discharge.housingDetails')} placeholder={t('discharge.housingPlaceholder')} value={d.housingDetails} onChange={(housingDetails) => updateDischarge({ housingDetails })} />
        {plan.identity.ageBand === 'under_18' && <Field label={t('discharge.receivingAdult')} value={d.receivingAdult} onChange={(receivingAdult) => updateDischarge({ receivingAdult })} />}
        {housingBlocked && (
          <View accessibilityRole="alert" style={[styles.blockCard, { borderColor: colors.coral, backgroundColor: colors.coralLight }]}>
            <Text style={[styles.blockText, { color: colors.coral }]}>{t('discharge.adultBlock')}</Text>
          </View>
        )}
      </Section>

      <Section title={t('sectionSober')}>
        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.soberStatus')}</Text>
        <Choices value={d.soberLivingStatus} options={[
          { value: 'named', label: t('discharge.named') }, { value: 'none_named', label: t('discharge.noneNamed') },
        ]} onChange={(soberLivingStatus) => updateDischarge({ soberLivingStatus: soberLivingStatus as typeof d.soberLivingStatus })} />
        {d.soberLivingStatus === 'named' && <>
          <Field label={t('discharge.soberName')} value={d.soberLivingName} onChange={(soberLivingName) => updateDischarge({ soberLivingName })} />
          <Field label={t('discharge.soberCity')} value={d.soberLivingCity} onChange={(soberLivingCity) => updateDischarge({ soberLivingCity })} />
          <Field label={t('discharge.soberPhone')} keyboardType="phone-pad" value={d.soberLivingPhone} onChange={(soberLivingPhone) => updateDischarge({ soberLivingPhone })} />
          <Field label={t('discharge.soberStart')} placeholder={t('discharge.datePlaceholder')} value={d.soberLivingStartDate} onChange={(soberLivingStartDate) => updateDischarge({ soberLivingStartDate })} />
          <Field multiline label={t('discharge.soberRules')} value={d.soberLivingRules} onChange={(soberLivingRules) => updateDischarge({ soberLivingRules })} />
        </>}
      </Section>

      <Section title={t('sectionOutpatient')}>
        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.outpatientStatus')}</Text>
        <Choices value={d.outpatientStatus} options={[
          { value: 'named', label: t('discharge.named') }, { value: 'none_named', label: t('discharge.noneNamed') },
        ]} onChange={(outpatientStatus) => updateDischarge({ outpatientStatus: outpatientStatus as typeof d.outpatientStatus })} />
        {d.outpatientStatus === 'named' && <>
          <Field label={t('discharge.outpatientName')} value={d.outpatientName} onChange={(outpatientName) => updateDischarge({ outpatientName })} />
          <Field label={t('discharge.outpatientStart')} placeholder={t('discharge.datePlaceholder')} value={d.outpatientStartDate} onChange={(outpatientStartDate) => updateDischarge({ outpatientStartDate })} />
          <Field multiline label={t('discharge.outpatientSchedule')} value={d.outpatientSchedule} onChange={(outpatientSchedule) => updateDischarge({ outpatientSchedule })} />
          <Field multiline label={t('discharge.outpatientTransport')} value={d.outpatientTransport} onChange={(outpatientTransport) => updateDischarge({ outpatientTransport })} />
        </>}
      </Section>

      <Section title={t('sectionRecovery')}>
        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.fellowship')}</Text>
        <Choices value={d.fellowship} options={['aa', 'na', 'ca', 'smart', 'refuge', 'other'].map((value) => ({ value, label: t(`discharge.fellowships.${value}`) }))} onChange={(fellowship) => updateDischarge({ fellowship: fellowship as typeof d.fellowship })} />
        {d.fellowship === 'other' && <Field label={t('discharge.fellowshipOther')} value={d.fellowshipOther} onChange={(fellowshipOther) => updateDischarge({ fellowshipOther })} />}
        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.meetingsKnown')}</Text>
        <Choices value={d.meetingsKnown} options={[{ value: 'yes', label: t('discharge.yes') }, { value: 'no', label: t('discharge.noNotComplete') }]} onChange={(meetingsKnown) => updateDischarge({ meetingsKnown: meetingsKnown as typeof d.meetingsKnown })} />
        <Field multiline label={t('discharge.firstMeetings')} value={d.firstMeetings} onChange={(firstMeetings) => updateDischarge({ firstMeetings })} />
        <Field multiline label={t('discharge.meetingPlace')} value={d.meetingPlace} onChange={(meetingPlace) => updateDischarge({ meetingPlace })} />
        <Field multiline label={t('discharge.backupMeeting')} value={d.backupMeeting} onChange={(backupMeeting) => updateDischarge({ backupMeeting })} />

        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.employmentStatus')}</Text>
        <Choices value={d.employmentStatus} options={['work', 'school', 'not_yet', 'disabled', 'unknown'].map((value) => ({ value, label: t(`discharge.employment.${value}`) }))} onChange={(employmentStatus) => updateDischarge({ employmentStatus: employmentStatus as typeof d.employmentStatus })} />
        {(d.employmentStatus === 'work' || d.employmentStatus === 'school') && <Field multiline label={t('discharge.employmentDetails')} value={d.employmentDetails} onChange={(employmentDetails) => updateDischarge({ employmentDetails })} />}
        <Field label={t('discharge.employmentHelper')} value={d.employmentHelper} onChange={(employmentHelper) => updateDischarge({ employmentHelper })} />

        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.aftercareStatus')}</Text>
        <Choices value={d.aftercareStatus} options={[{ value: 'named', label: t('discharge.named') }, { value: 'none_named', label: t('discharge.noneNamed') }]} onChange={(aftercareStatus) => updateDischarge({ aftercareStatus: aftercareStatus as typeof d.aftercareStatus })} />
        {d.aftercareStatus === 'named' && <>
          <Field label={t('discharge.aftercareName')} value={d.aftercareName} onChange={(aftercareName) => updateDischarge({ aftercareName })} />
          <Field label={t('discharge.aftercareContact')} value={d.aftercareContact} onChange={(aftercareContact) => updateDischarge({ aftercareContact })} />
        </>}

        <Text style={[styles.label, { color: colors.ink }]}>{t('discharge.medicationStatus')}</Text>
        <Choices value={d.medicationStatus} options={[{ value: 'yes', label: t('discharge.yes') }, { value: 'no', label: t('discharge.no') }]} onChange={(medicationStatus) => updateDischarge({ medicationStatus: medicationStatus as typeof d.medicationStatus })} />
        {d.medicationStatus === 'yes' && <Field label={t('discharge.medicationHolder')} value={d.medicationListHolder} onChange={(medicationListHolder) => updateDischarge({ medicationListHolder })} />}
        <Text style={[styles.hint, { color: colors.inkSoft }]}>{t('discharge.medicationRule')}</Text>
        <Field multiline label={t('discharge.other')} placeholder={t('discharge.otherPlaceholder')} value={d.otherInstructions} onChange={(otherInstructions) => updateDischarge({ otherInstructions })} />
      </Section>
    </>
  );
}

function ItemCard({ controller, definition }: { controller: Controller; definition: HomecomingItemDefinition }) {
  const { t } = useTranslation('homecomingWeek');
  const { colors } = useTheme();
  const item = controller.plan.items[definition.id];
  const complete = isHomecomingItemComplete(controller.plan, definition);
  const allowNA = canHomecomingItemBeNotApplicable(controller.plan, definition.id);
  const statuses: HomecomingStatus[] = allowNA
    ? ['not_started', 'working', 'confirmed', 'not_applicable']
    : ['not_started', 'working', 'confirmed'];
  return (
    <View style={[styles.itemCard, { borderColor: complete ? colors.green : colors.line, backgroundColor: colors.white }]}>
      <Text style={[styles.itemTitle, { color: colors.ink }]}>{t(`items.${definition.id}.title`)}</Text>
      <Text style={[styles.itemBody, { color: colors.inkSoft }]}>{t(`items.${definition.id}.body`)}</Text>
      <Choices value={item.status} options={statuses.map((value) => ({ value, label: t(`status.${value}`) }))} onChange={(status) => controller.updateItem(definition.id, { status: status as HomecomingStatus })} />
      {item.status === 'not_applicable' ? (
        <Field multiline label={t('itemFields.naReason')} value={item.details} onChange={(details) => controller.updateItem(definition.id, { details })} />
      ) : item.status !== 'not_started' ? (
        <>
          <Field label={t('itemFields.person')} value={item.person} onChange={(person) => controller.updateItem(definition.id, { person })} />
          <Field label={t('itemFields.place')} value={item.place} onChange={(place) => controller.updateItem(definition.id, { place })} />
          <Field label={t('itemFields.time')} value={item.time} onChange={(time) => controller.updateItem(definition.id, { time })} />
          <Field label={t('itemFields.backup')} value={item.backup} onChange={(backup) => controller.updateItem(definition.id, { backup })} />
          <Field multiline label={t('itemFields.details')} placeholder={t(`items.${definition.id}.details`)} value={item.details} onChange={(details) => controller.updateItem(definition.id, { details })} />
        </>
      ) : null}
    </View>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderColor: colors.line, backgroundColor: colors.cream }]}>
      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>
      {hint && <Text style={[styles.sectionHint, { color: colors.inkSoft }]}>{hint}</Text>}
      {children}
    </View>
  );
}

function Field({ label, value, onChange, placeholder, multiline = false, keyboardType }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: KeyboardTypeOptions;
}) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        multiline={multiline}
        keyboardType={keyboardType}
        maxLength={multiline ? 350 : 180}
        style={[multiline ? styles.textarea : styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.white }]}
      />
    </View>
  );
}

function Choices({ value, options, onChange }: { value: string; options: ChoiceOption[]; onChange: (value: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.choice, { borderColor: selected ? colors.primary : colors.line, backgroundColor: selected ? colors.primaryLight : colors.white }]}
          >
            <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.ink }]}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ActionButton({ label, onPress, destructive = false }: { label: string; onPress: () => void; destructive?: boolean }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={[styles.action, { backgroundColor: destructive ? colors.coral : colors.primary }]}>
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 52 },
  back: { fontSize: 14, fontWeight: '800', marginBottom: 18 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  title: { fontSize: 31, lineHeight: 36, fontWeight: '900', marginTop: 5 },
  intro: { fontSize: 15, lineHeight: 22, marginTop: 8 },
  privacy: { fontSize: 11.5, lineHeight: 17, fontWeight: '800', marginTop: 9, marginBottom: 15 },
  safetyStack: { gap: 8, marginBottom: 14 },
  safetyCard: { borderWidth: 1.5, borderRadius: 13, padding: 12 },
  safetyTitle: { fontSize: 13.5, fontWeight: '900' },
  safetyBody: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  safetyLink: { fontSize: 13, fontWeight: '900', marginTop: 7 },
  stateCard: { borderWidth: 1.5, borderRadius: 16, padding: 18, gap: 10, alignItems: 'center' },
  stateText: { fontSize: 14, fontWeight: '800', textAlign: 'center' },
  stateTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  stateBody: { fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  progressCard: { borderWidth: 2, borderRadius: 18, padding: 17, marginBottom: 14 },
  progressKicker: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1 },
  progressTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900', marginTop: 4 },
  progressBody: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  count: { fontSize: 13, fontWeight: '800', marginTop: 10 },
  missing: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  track: { height: 7, borderRadius: 99, overflow: 'hidden', marginTop: 9 },
  fill: { height: '100%', borderRadius: 99 },
  saveText: { fontSize: 11.5, fontWeight: '700', marginTop: 8 },
  section: { borderWidth: 1, borderRadius: 17, padding: 16, marginBottom: 14 },
  sectionTitle: { fontSize: 19, fontWeight: '900' },
  sectionHint: { fontSize: 12, lineHeight: 17, marginTop: 3, marginBottom: 3 },
  label: { fontSize: 12, fontWeight: '800', marginTop: 12, marginBottom: 5 },
  hint: { fontSize: 11.5, lineHeight: 17, marginTop: 6 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, fontSize: 13.5 },
  textarea: { minHeight: 78, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, fontSize: 13.5, textAlignVertical: 'top' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 },
  choice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  choiceText: { fontSize: 12, fontWeight: '800' },
  fitCard: { borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 10 },
  fitText: { fontSize: 12.5, lineHeight: 18, fontWeight: '700' },
  checkRow: { borderWidth: 1, borderRadius: 12, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 11 },
  checkbox: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontWeight: '900' },
  checkLabel: { flex: 1, fontSize: 12.5, lineHeight: 18, fontWeight: '800' },
  blockCard: { borderWidth: 1.5, borderRadius: 12, padding: 11, marginTop: 10 },
  blockText: { fontSize: 12.5, lineHeight: 18, fontWeight: '800' },
  category: { fontSize: 13, fontWeight: '900', letterSpacing: 0.6, marginTop: 14, marginBottom: 7 },
  itemCard: { borderWidth: 1.5, borderRadius: 14, padding: 13, marginBottom: 9 },
  itemTitle: { fontSize: 15, lineHeight: 20, fontWeight: '900' },
  itemBody: { fontSize: 12.5, lineHeight: 18, marginTop: 4, marginBottom: 4 },
  action: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 17, alignItems: 'center', marginTop: 4, minWidth: 190 },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  footer: { fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginHorizontal: 8, marginTop: 3 },
  clearButton: { alignItems: 'center', padding: 14, marginTop: 8 },
  clearText: { fontSize: 12.5, fontWeight: '900' },
});
