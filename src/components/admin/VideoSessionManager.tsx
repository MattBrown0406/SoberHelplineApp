import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import {
  AdminVideoSession,
  AdminVideoSessionsState,
  VideoStaff,
} from '../../hooks/useAdminVideoSessions';

type Segment = 'needsAction' | 'upcoming' | 'live' | 'history';
type EditorMode = 'counteroffer' | 'reschedule' | 'cancel' | null;
const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'needsAction', label: 'Needs Action' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'live', label: 'Live' },
  { key: 'history', label: 'History' },
];

export function VideoSessionManager({ sessions }: { sessions: AdminVideoSessionsState }) {
  const router = useRouter();
  const { colors } = useTheme();
  const [segment, setSegment] = useState<Segment>('needsAction');
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (segment === 'history' && !sessions.historyLoaded) void sessions.loadHistory(true);
  }, [segment, sessions.historyLoaded]); // loadHistory intentionally omitted: it changes with pagination state

  const current = segment === 'history' ? sessions.history : sessions[segment];
  const loading = segment === 'history' ? sessions.historyLoading : sessions.activeLoading;
  const error = segment === 'history' ? sessions.historyError : sessions.activeError;
  const retry = segment === 'history' ? () => void sessions.loadHistory(true) : () => void sessions.refreshActive();

  return (
    <View style={[styles.container, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.ink }]}>Premier Video Scheduling</Text>
          <Text style={[styles.subtitle, { color: colors.inkSoft }]}>Active sessions only; archived sessions are in History.</Text>
        </View>
        <ActionButton label="Refresh" onPress={retry} color={colors.primary} />
      </View>

      <View style={[styles.segments, { borderColor: colors.line }]} accessibilityRole="tablist">
        {SEGMENTS.map((item) => {
          const selected = segment === item.key;
          const count = item.key === 'history' ? sessions.history.length : sessions[item.key].length;
          return (
            <TouchableOpacity
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.segment, selected && { backgroundColor: colors.primary }]}
              onPress={() => setSegment(item.key)}
            >
              <Text style={[styles.segmentText, { color: selected ? '#fff' : colors.ink }]}>{item.label}{count ? ` (${count})` : ''}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {sessions.actionError ? (
        <ErrorBox message={sessions.actionError} onRetry={() => { sessions.clearActionError(); void sessions.refreshActive(); }} />
      ) : null}
      {loading && current.length === 0 ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
      {error ? <ErrorBox message={error} onRetry={retry} /> : null}
      {!loading && !error && current.length === 0 ? (
        <Text style={[styles.empty, { color: colors.inkSoft }]}>No sessions in this section.</Text>
      ) : null}

      {current.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          staff={sessions.staff}
          busy={sessions.actingId === session.id}
          history={segment === 'history'}
          expanded={expandedHistory.has(session.id)}
          onToggle={() => setExpandedHistory((previous) => {
            const next = new Set(previous);
            if (next.has(session.id)) next.delete(session.id); else next.add(session.id);
            return next;
          })}
          onJoin={() => router.push({ pathname: '/video-session' as never, params: { sessionId: session.id } })}
          runAction={sessions.runAction}
        />
      ))}

      {segment === 'history' && sessions.historyHasMore && !sessions.historyError ? (
        <ActionButton
          label={sessions.historyLoading ? 'Loading…' : 'Load more history'}
          disabled={sessions.historyLoading}
          onPress={() => void sessions.loadHistory(false)}
          color={colors.primary}
          filled
        />
      ) : null}
    </View>
  );
}

function SessionCard({ session, staff, busy, history, expanded, onToggle, onJoin, runAction }: {
  session: AdminVideoSession;
  staff: VideoStaff[];
  busy: boolean;
  history: boolean;
  expanded: boolean;
  onToggle: () => void;
  onJoin: () => void;
  runAction: (session: AdminVideoSession, rpc: string, params?: Record<string, unknown>) => Promise<boolean>;
}) {
  const { colors } = useTheme();
  const [editor, setEditor] = useState<EditorMode>(null);
  const [date, setDate] = useState(() => new Date(session.scheduled_for ?? session.requested_start));
  const [note, setNote] = useState('');
  const [coachId, setCoachId] = useState(session.assigned_coach_id ?? staff[0]?.account_id ?? '');
  const coach = staff.find((item) => item.account_id === session.assigned_coach_id);

  useEffect(() => {
    if (!coachId && staff[0]) setCoachId(staff[0].account_id);
  }, [coachId, staff]);

  useEffect(() => {
    if (session.assigned_coach_id) setCoachId(session.assigned_coach_id);
  }, [session.assigned_coach_id]);

  const memberTime = formatInTimezone(session.requested_start, session.requested_timezone);
  const localTime = new Date(session.requested_start).toLocaleString([], DATE_OPTIONS);
  const scheduledLocal = session.scheduled_for ? new Date(session.scheduled_for).toLocaleString([], DATE_OPTIONS) : null;

  if (history && !expanded) {
    return (
      <TouchableOpacity style={[styles.session, { borderColor: colors.line }]} onPress={onToggle} accessibilityRole="button">
        <View style={styles.titleRow}>
          <Text style={[styles.member, { color: colors.ink }]}>{session.memberName || `Member ${session.account_id.slice(0, 8)}`}</Text>
          <Status status={session.status} />
        </View>
        <Text style={[styles.meta, { color: colors.inkSoft }]}>{scheduledLocal ?? memberTime} · Tap for details</Text>
      </TouchableOpacity>
    );
  }

  const scheduleAction = async () => {
    const rpc = editor === 'counteroffer' ? 'coach_counteroffer_video_session' : 'coach_reschedule_video_session';
    const ok = await runAction(session, rpc, {
      p_starts_at: date.toISOString(),
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      p_duration_minutes: session.duration_minutes,
      p_note: note.trim() || null,
      ...(rpc === 'coach_counteroffer_video_session' ? { p_coach_id: coachId || null } : {}),
    });
    if (ok) setEditor(null);
  };

  return (
    <View style={[styles.session, { borderColor: colors.line }]}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.member, { color: colors.ink }]}>{session.memberName || `Member ${session.account_id.slice(0, 8)}`}</Text>
          <Text selectable style={[styles.accountId, { color: colors.inkSoft }]}>Account: {session.account_id}</Text>
        </View>
        <Status status={session.status} />
      </View>

      <Text style={[styles.timeLabel, { color: colors.ink }]}>Member requested</Text>
      <Text style={[styles.time, { color: colors.ink }]}>{memberTime}</Text>
      <Text style={[styles.meta, { color: colors.inkSoft }]}>Member timezone: {session.requested_timezone} · Coach local: {localTime}</Text>
      <Text style={[styles.meta, { color: colors.inkSoft }]}>Duration: {session.duration_minutes} minutes · Version {session.version}</Text>
      {scheduledLocal ? <Text style={[styles.scheduled, { color: colors.primary }]}>Scheduled (coach local): {scheduledLocal}</Text> : null}
      {coach ? <Text style={[styles.meta, { color: colors.inkSoft }]}>Assigned: {coach.name}</Text> : session.assigned_coach_id ? <Text style={[styles.meta, { color: colors.inkSoft }]}>Assigned coach: {session.assigned_coach_id}</Text> : null}
      {session.member_note ? <Text style={[styles.note, { color: colors.ink }]}>Member note: {session.member_note}</Text> : null}
      {session.pendingProposal ? (
        <View style={[styles.proposal, { backgroundColor: colors.secondaryLight }]}>
          <Text style={[styles.proposalTitle, { color: colors.ink }]}>Pending {session.pendingProposal.proposed_by_role} proposal</Text>
          <Text style={[styles.meta, { color: colors.ink }]}>{formatInTimezone(session.pendingProposal.starts_at, session.pendingProposal.timezone)} · {session.pendingProposal.duration_minutes} min</Text>
          {session.pendingProposal.note ? <Text style={[styles.meta, { color: colors.ink }]}>{session.pendingProposal.note}</Text> : null}
        </View>
      ) : null}
      {history ? (
        <>
          {session.completion_outcome ? <Text style={[styles.note, { color: colors.ink }]}>Outcome: {session.completion_outcome.replace(/_/g, ' ')}</Text> : null}
          {session.cancellation_reason ? <Text style={[styles.note, { color: colors.ink }]}>Cancellation reason: {session.cancellation_reason}</Text> : null}
          <ActionButton label="Collapse" onPress={onToggle} color={colors.primary} />
        </>
      ) : (
        <>
          <View style={styles.actions}>
            {session.status === 'requested' ? <ActionButton label="Confirm requested time" disabled={busy || !coachId} onPress={() => void runAction(session, 'coach_confirm_video_session', { p_coach_id: coachId || null })} color={colors.green} filled /> : null}
            {session.status === 'requested' ? <ActionButton label="Counteroffer" disabled={busy} onPress={() => setEditor('counteroffer')} color={colors.primary} /> : null}
            {session.status === 'scheduled' ? <ActionButton label="Reschedule" disabled={busy} onPress={() => {
              setCoachId(session.assigned_coach_id ?? '');
              setDate(new Date(session.scheduled_for ?? session.requested_start));
              setEditor('reschedule');
            }} color={colors.primary} /> : null}
            {session.status === 'scheduled' ? <ActionButton label="Start" disabled={busy} onPress={() => void runAction(session, 'coach_start_video_session')} color={colors.green} filled /> : null}
            {session.status === 'live' ? <ActionButton label="Join" disabled={busy} onPress={onJoin} color={colors.primary} filled /> : null}
            {session.status === 'live' ? <ActionButton label="Complete" disabled={busy} onPress={() => void runAction(session, 'coach_complete_video_session')} color={colors.green} /> : null}
            {session.status === 'scheduled' || session.status === 'live' ? <ActionButton label="Member no-show" disabled={busy} onPress={() => void runAction(session, 'coach_mark_member_no_show')} color={colors.coral} /> : null}
            {session.status === 'scheduled' || session.status === 'live' ? <ActionButton label="Coach no-show" disabled={busy} onPress={() => void runAction(session, 'coach_mark_coach_no_show')} color={colors.coral} /> : null}
            {session.status === 'requested' || session.status === 'scheduled' ? <ActionButton label="Cancel" disabled={busy} onPress={() => setEditor('cancel')} color={colors.coral} /> : null}
          </View>
          {session.status === 'requested' ? <CoachPicker staff={staff} selected={coachId} onSelect={setCoachId} /> : null}
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
          {editor ? (
            <View style={[styles.editor, { borderColor: colors.line }]}>
              {editor !== 'cancel' ? (
                <>
                  <Text style={[styles.editorTitle, { color: colors.ink }]}>{editor === 'counteroffer' ? 'Propose another time' : 'Reschedule session'}</Text>
                  {editor === 'reschedule' ? (
                    <Text style={[styles.assignmentNotice, { color: colors.ink }]}>Assigned coach remains: {coach?.name ?? session.assigned_coach_id ?? 'Unassigned'}</Text>
                  ) : null}
                  <Picker value={date} onChange={setDate} />
                  <Text style={[styles.meta, { color: colors.inkSoft }]}>Coach local: {date.toLocaleString([], DATE_OPTIONS)}</Text>
                </>
              ) : <Text style={[styles.editorTitle, { color: colors.ink }]}>Cancellation reason</Text>}
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={editor === 'cancel' ? 'Reason (required)' : 'Optional note for member'}
                placeholderTextColor={colors.inkSoft}
                multiline
                style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
              />
              <View style={styles.actions}>
                <ActionButton
                  label={editor === 'cancel' ? 'Cancel session' : 'Send proposal'}
                  disabled={busy || (editor === 'cancel' && !note.trim())}
                  onPress={() => editor === 'cancel'
                    ? void runAction(session, 'coach_cancel_video_session', { p_reason: note.trim() }).then((ok) => { if (ok) setEditor(null); })
                    : void scheduleAction()}
                  color={editor === 'cancel' ? colors.coral : colors.primary}
                  filled
                />
                <ActionButton label="Close" disabled={busy} onPress={() => setEditor(null)} color={colors.inkSoft} />
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function CoachPicker({ staff, selected, onSelect }: { staff: VideoStaff[]; selected: string; onSelect: (id: string) => void }) {
  const { colors } = useTheme();
  if (!staff.length) return <Text style={[styles.meta, { color: colors.coral }]}>No active staff assignments are visible.</Text>;
  return (
    <View>
      <Text style={[styles.timeLabel, { color: colors.ink }]}>Assign coach</Text>
      <View style={styles.actions}>
        {staff.map((person) => (
          <TouchableOpacity
            key={person.account_id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === person.account_id }}
            style={[styles.coachChoice, { borderColor: selected === person.account_id ? colors.primary : colors.line, backgroundColor: selected === person.account_id ? colors.primaryLight : 'transparent' }]}
            onPress={() => onSelect(person.account_id)}
          >
            <Text style={{ color: colors.ink, fontWeight: '600' }}>{person.name} ({person.role})</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function Picker({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  if (Platform.OS === 'android') {
    return (
      <View style={styles.pickers}>
        <DateTimePicker value={value} mode="date" minimumDate={new Date()} onChange={(_event, date) => date && onChange(date)} />
        <DateTimePicker value={value} mode="time" onChange={(_event, date) => date && onChange(date)} />
      </View>
    );
  }
  return <DateTimePicker value={value} mode="datetime" minimumDate={new Date()} onChange={(_event, date) => date && onChange(date)} />;
}

function Status({ status }: { status: AdminVideoSession['status'] }) {
  const { colors } = useTheme();
  const live = status === 'live';
  return (
    <View style={[styles.status, { backgroundColor: live ? colors.greenLight : colors.primaryLight }]}>
      <Text style={[styles.statusText, { color: live ? colors.green : colors.primary }]}>{status.replace(/_/g, ' ')}</Text>
    </View>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.error, { backgroundColor: colors.coralLight }]}>
      <Text style={[styles.errorText, { color: colors.coral }]}>{message}</Text>
      <ActionButton label="Retry" onPress={onRetry} color={colors.coral} />
    </View>
  );
}

function ActionButton({ label, onPress, color, filled = false, disabled = false }: { label: string; onPress: () => void; color: string; filled?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { borderColor: color, backgroundColor: filled ? color : 'transparent', opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.buttonText, { color: filled ? '#fff' : color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
function formatInTimezone(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { ...DATE_OPTIONS, timeZone: timezone, timeZoneName: 'short' }).format(new Date(value));
  } catch {
    return `${new Date(value).toLocaleString([], DATE_OPTIONS)} (${timezone})`;
  }
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 17, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 3 },
  segments: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderRadius: 10, overflow: 'hidden', marginVertical: 14 },
  segment: { minHeight: 44, flexGrow: 1, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 12, fontWeight: '700' },
  loader: { margin: 20 },
  empty: { fontSize: 14, paddingVertical: 18, textAlign: 'center' },
  session: { borderTopWidth: 1, paddingVertical: 14, gap: 5 },
  member: { fontSize: 16, fontWeight: '700' },
  accountId: { fontSize: 10, marginTop: 2 },
  status: { borderRadius: 99, paddingVertical: 5, paddingHorizontal: 9 },
  statusText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  timeLabel: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  time: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 17 },
  scheduled: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 3 },
  note: { fontSize: 13, lineHeight: 18, marginTop: 5 },
  proposal: { padding: 10, borderRadius: 8, marginTop: 8 },
  proposalTitle: { fontSize: 12, fontWeight: '800', marginBottom: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  button: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  coachChoice: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' },
  editor: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 10 },
  editorTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  assignmentNotice: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginBottom: 8 },
  pickers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 8, textAlignVertical: 'top' },
  error: { borderRadius: 8, padding: 10, marginBottom: 10 },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
