import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { TFunction } from 'i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { usePrivateVideoSessions, PrivateVideoSession } from '../../hooks/usePrivateVideoSessions';
import { detectedTimeZone, formatInTimeZone, googleCalendarUrl } from '../../lib/videoScheduling';

type Controller = ReturnType<typeof usePrivateVideoSessions>;
type Props = { controller: Controller; t: TFunction<any>; translationRoot: string; onJoin: (session: PrivateVideoSession) => void; compact?: boolean };

function initialDate() { const d = new Date(Date.now() + 24 * 60 * 60 * 1000); d.setMinutes(0, 0, 0); return d; }

export function PremierVideoSchedulingCard({ controller, t, translationRoot, onJoin, compact }: Props) {
  const { colors } = useTheme();
  const k = (key: string, options?: Record<string, unknown>) => t(`${translationRoot}.${key}`, options);
  const zone = useMemo(detectedTimeZone, []);
  const [editing, setEditing] = useState(false);
  const [startsAt, setStartsAt] = useState(initialDate);
  const [note, setNote] = useState('');
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const { activeSession: session, pendingProposal: proposal } = controller;

  const changeDate = (mode: 'date' | 'time') => (_event: DateTimePickerEvent, picked?: Date) => {
    if (Platform.OS !== 'ios') mode === 'date' ? setShowDate(false) : setShowTime(false);
    if (!picked) return;
    setStartsAt((current) => {
      const next = new Date(current);
      if (mode === 'date') next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      else next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      return next;
    });
  };

  async function submit() {
    if (startsAt.getTime() <= Date.now()) { Alert.alert(k('errors.invalidTitle'), k('errors.future')); return; }
    const input = { startsAt, timezone: zone, durationMinutes: 60, note };
    const result = session ? await controller.rescheduleSession(session, input) : await controller.requestSession(input);
    if (result) { setEditing(false); setNote(''); }
  }

  function confirmCancel() {
    if (!session) return;
    Alert.alert(k('cancelTitle'), k('cancelBody'), [
      { text: k('keep'), style: 'cancel' },
      { text: k('cancel'), style: 'destructive', onPress: () => void controller.cancelSession(session) },
    ]);
  }

  const displayedError = controller.errorKey ? k(`errors.${controller.errorKey}`) : controller.error;
  const proposedByCoach = proposal?.proposed_by_role === 'coach';
  const requestedValue = proposal?.starts_at ?? session?.requested_start;
  const calendarUrl = session ? googleCalendarUrl(session) : null;

  return <View>
    <Text style={[styles.timezone, { color: colors.inkSoft }]}>{k('timezone', { timezone: zone })}</Text>
    {controller.loading && !session ? <ActivityIndicator color={colors.primary} accessibilityLabel={k('loading')} /> : null}
    {displayedError ? <View style={[styles.error, { borderColor: colors.coral }]}><Text accessibilityRole="alert" style={{ color: colors.coral }}>{displayedError}</Text><TouchableOpacity accessibilityRole="button" onPress={() => void controller.load()}><Text style={{ color: colors.primary, fontWeight: '800' }}>{k('retry')}</Text></TouchableOpacity></View> : null}

    {!session && !editing ? <Action label={k('request')} onPress={() => setEditing(true)} colors={colors} /> : null}

    {session && !editing ? <View style={[styles.status, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
      <Text style={[styles.statusTitle, { color: colors.primary }]}>{k(`statuses.${proposedByCoach ? 'coach_proposal' : session.status}`)}</Text>
      {session.status === 'requested' && requestedValue ? <Text style={[styles.body, { color: colors.ink }]}>{formatInTimeZone(requestedValue, proposal?.timezone ?? session.requested_timezone)} · {proposal?.duration_minutes ?? session.duration_minutes} {k('minutes')}</Text> : null}
      {session.status === 'requested' ? <Text style={[styles.body, { color: colors.inkSoft }]}>{k(proposedByCoach ? 'coachProposalBody' : 'memberProposalBody')}</Text> : null}
      {(session.status === 'scheduled' || session.status === 'live') && session.scheduled_for ? <>
        <Text style={[styles.body, { color: colors.ink }]}>{k('confirmedRequestedZone', { date: formatInTimeZone(session.scheduled_for, session.requested_timezone), timezone: session.requested_timezone })}</Text>
        {zone !== session.requested_timezone ? <Text style={[styles.body, { color: colors.inkSoft }]}>{k('deviceTime', { date: formatInTimeZone(session.scheduled_for, zone), timezone: zone })}</Text> : null}
      </> : null}
      {proposedByCoach ? <Action label={k('accept')} onPress={() => void controller.acceptProposal(session, proposal!)} colors={colors} busy={controller.mutating} /> : null}
      {session.status === 'live' ? <Action label={k('join')} onPress={() => onJoin(session)} colors={colors} /> : null}
      {session.status === 'scheduled' && calendarUrl ? <Secondary label={k('addCalendar')} onPress={() => void Linking.openURL(calendarUrl)} colors={colors} /> : null}
      {session.status !== 'live' ? <Secondary label={k(session.status === 'scheduled' ? 'reschedule' : 'newTime')} onPress={() => { setStartsAt(new Date(requestedValue ?? session.requested_start)); setEditing(true); }} colors={colors} /> : null}
      {session.status !== 'live' ? <Secondary label={k('cancel')} onPress={confirmCancel} colors={colors} danger /> : null}
    </View> : null}

    {editing ? <View style={[styles.form, { borderColor: colors.line }]}>
      <Text style={[styles.label, { color: colors.ink }]}>{k('dateTimeLabel')}</Text>
      <View style={styles.row}><Secondary label={formatInTimeZone(startsAt, zone).split(',').slice(0, 2).join(',')} onPress={() => setShowDate(true)} colors={colors} /><Secondary label={startsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} onPress={() => setShowTime(true)} colors={colors} /></View>
      {showDate ? <DateTimePicker value={startsAt} mode="date" minimumDate={new Date()} onChange={changeDate('date')} /> : null}
      {showTime ? <DateTimePicker value={startsAt} mode="time" minuteInterval={5} onChange={changeDate('time')} /> : null}
      <Text style={[styles.hint, { color: colors.inkSoft }]}>{k('durationAndZone', { timezone: zone })}</Text>
      <Text style={[styles.label, { color: colors.ink }]}>{k('noteLabel')}</Text>
      <TextInput accessibilityLabel={k('noteLabel')} value={note} onChangeText={setNote} maxLength={2000} multiline placeholder={k('notePlaceholder')} placeholderTextColor={colors.inkSoft} style={[styles.input, { borderColor: colors.line, color: colors.ink }]} />
      <Text style={[styles.count, { color: colors.inkSoft }]}>{note.length}/2000</Text>
      <Action label={session ? k('submitNewTime') : k('submit')} onPress={() => void submit()} colors={colors} busy={controller.mutating} />
      <Secondary label={k('keep')} onPress={() => setEditing(false)} colors={colors} />
    </View> : null}

    {!compact && controller.history.length ? <View style={styles.history}><Text style={[styles.label, { color: colors.ink }]}>{k('history')}</Text>{controller.history.slice(0, 5).map((item) => <View key={item.id} style={[styles.historyRow, { borderColor: colors.line }]}><View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontWeight: '700' }}>{k(`statuses.${item.status}`)}</Text><Text style={[styles.hint, { color: colors.inkSoft }]}>{formatInTimeZone(item.scheduled_for ?? item.requested_start, item.requested_timezone)}</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel={k('rebook')} onPress={() => { const next = initialDate(); next.setHours(new Date(item.requested_start).getHours(), new Date(item.requested_start).getMinutes()); setStartsAt(next); setNote(item.member_note ?? ''); setEditing(true); }}><Text style={{ color: colors.primary, fontWeight: '800' }}>{k('rebook')}</Text></TouchableOpacity></View>)}</View> : null}
  </View>;
}

function Action({ label, onPress, colors, busy }: { label: string; onPress: () => void; colors: any; busy?: boolean }) { return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} style={[styles.action, { backgroundColor: colors.primary }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionText}>{label}</Text>}</TouchableOpacity>; }
function Secondary({ label, onPress, colors, danger }: { label: string; onPress: () => void; colors: any; danger?: boolean }) { return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.secondary, { borderColor: danger ? colors.coral : colors.primary }]}><Text style={{ color: danger ? colors.coral : colors.primary, fontWeight: '800' }}>{label}</Text></TouchableOpacity>; }
const styles = StyleSheet.create({ timezone: { fontSize: 12, marginBottom: 8 }, status: { padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 10 }, statusTitle: { fontSize: 15, fontWeight: '900', marginBottom: 5 }, body: { fontSize: 13, lineHeight: 19, marginTop: 2 }, action: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 }, actionText: { color: '#fff', fontWeight: '900' }, secondary: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', marginTop: 8 }, form: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 }, label: { fontSize: 13, fontWeight: '900', marginTop: 4, marginBottom: 6 }, row: { flexDirection: 'row', gap: 8 }, hint: { fontSize: 12, lineHeight: 17, marginTop: 5 }, input: { minHeight: 80, borderWidth: 1, borderRadius: 10, padding: 10, textAlignVertical: 'top' }, count: { fontSize: 11, textAlign: 'right' }, error: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 7 }, history: { marginTop: 16 }, historyRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingVertical: 9 }, });
