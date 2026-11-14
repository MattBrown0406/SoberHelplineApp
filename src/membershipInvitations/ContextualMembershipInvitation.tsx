import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../contexts/AccountContext';
import { logMembershipPath } from '../lib/funnel';
import { plansHref, type PlanSource } from '../lib/membershipPath';
import { createInvitationPolicy, type Placement } from './policy';

const policy = createInvitationPolicy(AsyncStorage);
/** Where she was when the invitation appeared: the only thing logged about it. */
const SOURCE: Record<Placement, PlanSource> = {
  'practice-completed': 'practice_completed',
  'boundary-saved': 'boundary_saved',
  'after-meeting': 'after_meeting',
};
/** plans.json keys for each placement's own line (and title, when it has one). */
const LINE: Record<Placement, { title: string; body: string }> = {
  'practice-completed': { title: 'invite.title', body: 'invite.practiceCompleted' },
  'boundary-saved': { title: 'invite.title', body: 'invite.boundarySaved' },
  'after-meeting': { title: 'invite.afterMeetingTitle', body: 'invite.afterMeeting' },
};
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
  const allowed = !!scope && scope === accountId && account.isAuthenticated && !account.isLoading &&
    !account.accountError && !account.isOfflineAccountFallback && !account.isAdmin && !account.isAttached &&
    account.accountState === 'direct-free';
  const live = useRef({ scope, allowed });
  live.current = { scope, allowed };
  const owned = useRef<string | null>(null);
  const previous = useRef({ scope, completed });
  const [shownFor, setShownFor] = useState<string | null>(null);
  useEffect(() => {
    const rising = previous.current.scope === scope && !previous.current.completed && completed;
    previous.current = { scope, completed };
    if (!allowed || !scope) { setShownFor(null); return; }
    if (!rising) return;
    let active = true;
    const current = () => active && live.current.scope === scope && live.current.allowed;
    void policy.claim(scope, placement, current).then(show => {
      if (show && current()) {
        owned.current = scope; setShownFor(scope);
        // The place only: never anything about the activity itself.
        logMembershipPath('membership_invite_shown', { source });
      }
      else if (show) policy.release(scope);
    });
    return () => { active = false; };
  }, [scope, allowed, completed, placement, source]);
  useEffect(() => () => { if (scope && owned.current === scope) { policy.release(scope); owned.current = null; } }, [scope]);
  if (!allowed || !completed || shownFor !== scope || !scope) return null;
  const dismiss = (permanent: boolean) => {
    setShownFor(null); owned.current = null;
    void policy.dismiss(scope, permanent, () => live.current.scope === scope && live.current.allowed);
  };
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>{t(LINE[placement].title)}</Text>
    <Text style={styles.body}>{t(LINE[placement].body)}</Text>
    <Text style={styles.body}>{t('invite.body')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('seePlansLabel')} style={styles.button} onPress={() => {
      if (live.current.scope !== scope || !live.current.allowed) return;
      setShownFor(null); owned.current = null; policy.release(scope);
      logMembershipPath('membership_invite_tapped', { source });
      router.push(plansHref(source));
    }}><Text style={styles.link}>{t('invite.cta')}</Text></Pressable>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('invite.later')} style={styles.button} onPress={() => dismiss(false)}><Text style={styles.link}>{t('invite.later')}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('invite.never')} style={styles.button} onPress={() => dismiss(true)}><Text style={styles.link}>{t('invite.never')}</Text></Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 16, marginVertical: 12, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, backgroundColor: '#F8FAFC' },
  title: { fontSize: 17, fontWeight: '600', color: '#17324D' },
  body: { fontSize: 15, lineHeight: 23, color: '#334155', marginTop: 6 },
  button: { minHeight: 44, minWidth: 44, paddingVertical: 12, paddingHorizontal: 8, justifyContent: 'center' },
  link: { color: '#174E75', fontSize: 15, textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
