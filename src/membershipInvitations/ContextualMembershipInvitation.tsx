import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../contexts/AccountContext';
import { usePlanOffers } from '../hooks/usePlanPurchase';
import { logMembershipPath } from '../lib/funnel';
import { plansHref, type PlanSource } from '../lib/membershipPath';
import { createInvitationPolicy, type Placement } from './policy';
import { askedThisVisit, noteInvitationShowing } from './visitAsks';

// One ask per visit: never on a visit that had the rating prompt or the reminder ask
// (and, while the card is up, those give way to it: noteInvitationShowing).
const policy = createInvitationPolicy(AsyncStorage, Date.now, askedThisVisit);
/** Where she was when the invitation appeared: the only thing logged about it. */
const SOURCE: Record<Placement, PlanSource> = {
  'practice-completed': 'practice_completed',
  'boundary-saved': 'boundary_saved',
  'after-meeting': 'after_meeting',
  'tool-finished': 'tool_finished',
  'checkin-week': 'checkin_week',
};
/** plans.json keys for each placement's own line (and title, when it has one). */
const LINE: Record<Placement, { title: string; body: string }> = {
  'practice-completed': { title: 'invite.title', body: 'invite.practiceCompleted' },
  'boundary-saved': { title: 'invite.title', body: 'invite.boundarySaved' },
  'after-meeting': { title: 'invite.afterMeetingTitle', body: 'invite.afterMeeting' },
  'tool-finished': { title: 'invite.title', body: 'invite.toolFinished' },
  'checkin-week': { title: 'invite.checkinWeekTitle', body: 'invite.checkinWeek' },
};
/** When her account was created, or null when not known (then she counts as new). */
function joinedAtMs(joinedAt: string | null | undefined): number | null {
  const ms = joinedAt ? Date.parse(joinedAt) : NaN;
  return Number.isFinite(ms) ? ms : null;
}
export interface ContextualMembershipInvitationProps {
  /** Account that performed the activity, captured before the async save. */
  accountId: string | null;
  /** Start false; transition to true ONLY after successful neutral activity. */
  completed: boolean;
  placement: Placement;
}
export function ContextualMembershipInvitation({ accountId, completed, placement }: ContextualMembershipInvitationProps) {
  const account = useAccount();
  const router = useRouter();
  const { t } = useTranslation('plans');
  const source = SOURCE[placement];
  const scope = account.user?.id ?? null;
  // "Settled": who she is and what she has are known for certain. Until then
  // nothing is shown, but a moment that arrives meanwhile is kept (below).
  // entitlementsSettled: a web or store membership may still be syncing (a
  // member reads as free until it is), so nothing is offered before it is.
  const settled = !account.isLoading && !account.accountError && !account.isOfflineAccountFallback &&
    account.entitlementsSettled;
  const allowed = !!scope && scope === accountId && account.isAuthenticated && settled &&
    !account.isAdmin && !account.isAttached && account.accountState === 'direct-free';
  const joinedAt = joinedAtMs(account.user?.joinedAt);
  const live = useRef({ scope, allowed, joinedAt });
  live.current = { scope, allowed, joinedAt };
  const owned = useRef<string | null>(null);
  const previous = useRef({ scope, completed });
  // The account a moment began for while it was still loading (or offline).
  const held = useRef<string | null>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);
  useEffect(() => {
    const rising = previous.current.scope === scope && !previous.current.completed && completed;
    previous.current = { scope, completed };
    // The moment came while her account was not settled yet (still loading
    // after a cold start, or the offline fallback): keep it, so the claim is
    // made when the account is known instead of being lost for good. Once the
    // account is settled and she simply may not see it (a paid or covered
    // member), or the moment is over, there is nothing to keep.
    if (!scope || !completed || held.current !== scope || (!allowed && settled)) held.current = null;
    if (scope && completed && !allowed && !settled && rising) held.current = scope;
    // The moment is over (or she may no longer see it): the card is gone, so
    // its claim goes back too. Without this a card she ignored came back at the
    // next moment with no claim at all (past the limits), and every other
    // placement was refused until the app restarted. (Today never unmounts.)
    if (!allowed || !scope || !completed) {
      setShownFor(null);
      if (owned.current) { policy.release(owned.current); owned.current = null; }
      return;
    }
    const wasHeld = held.current === scope;
    held.current = null;
    if (!rising && !wasHeld) return;
    // A new moment starts with nothing showing: only a fresh claim shows it.
    setShownFor(null);
    let active = true;
    const current = () => active && live.current.scope === scope && live.current.allowed;
    void policy.claim(scope, placement, current, { joinedAt: live.current.joinedAt }).then(show => {
      if (show && current()) {
        owned.current = scope; setShownFor(scope);
        // The place only: never anything about the activity itself.
        logMembershipPath('membership_invite_shown', { source });
      }
      else if (show) policy.release(scope);
    });
    return () => { active = false; };
  }, [scope, allowed, settled, completed, placement, source]);
  useEffect(() => () => { if (scope && owned.current === scope) { policy.release(scope); owned.current = null; } }, [scope]);
  const onScreen = !!scope && allowed && completed && shownFor === scope;
  // One ask per visit, the other way: the rating prompt and the reminder asks
  // give way on a visit that had this card, and while it is on screen.
  useEffect(() => {
    if (!onScreen || !scope) return undefined;
    noteInvitationShowing(scope, true);
    return () => noteInvitationShowing(scope, false);
  }, [onScreen, scope]);
  if (!onScreen || !scope) return null;
  const dismiss = (permanent: boolean) => {
    setShownFor(null); owned.current = null;
    void policy.dismiss(scope, permanent, () => live.current.scope === scope && live.current.allowed);
  };
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>{t(LINE[placement].title)}</Text>
    <Text style={styles.body}>{t(LINE[placement].body)}</Text>
    <Text style={styles.body}>{t('invite.body')}</Text>
    <TrialLine />
    <Pressable accessibilityRole="button" accessibilityLabel={t('seePlansLabel')} style={styles.button} onPress={() => {
      if (live.current.scope !== scope || !live.current.allowed) return;
      setShownFor(null); owned.current = null;
      // An answer: the run of cards she let pass starts again (and the claim is released).
      void policy.tapped(scope, () => live.current.scope === scope && live.current.allowed);
      logMembershipPath('membership_invite_tapped', { source });
      router.push(plansHref(source));
    }}><Text style={styles.link}>{t('invite.cta')}</Text></Pressable>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('invite.later')} style={styles.button} onPress={() => dismiss(false)}><Text style={styles.link}>{t('invite.later')}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('invite.never')} style={styles.button} onPress={() => dismiss(true)}><Text style={styles.link}>{t('invite.never')}</Text></Pressable>
    </View>
  </View>;
}
/**
 * One line, only when the App Store says Essential starts with a free trial
 * for her (the same answer the plans screen shows). Unknown or no trial:
 * nothing is said. Mounted only with the card, so the store is asked then.
 */
function TrialLine() {
  const { t } = useTranslation('plans');
  const trial = usePlanOffers().trialLabel('essential');
  return trial ? <Text style={styles.body}>{t('invite.trial', { trial })}</Text> : null;
}
const styles = StyleSheet.create({
  card: { padding: 16, marginVertical: 12, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, backgroundColor: '#F8FAFC' },
  title: { fontSize: 17, fontWeight: '600', color: '#17324D' },
  body: { fontSize: 15, lineHeight: 23, color: '#334155', marginTop: 6 },
  button: { minHeight: 44, minWidth: 44, paddingVertical: 12, paddingHorizontal: 8, justifyContent: 'center' },
  link: { color: '#174E75', fontSize: 15, textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
