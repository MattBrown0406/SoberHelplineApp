import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../contexts/AccountContext';
import { createInvitationPolicy, type Placement } from './policy';

const policy = createInvitationPolicy(AsyncStorage);
const copy = {
  en: { title: 'More support, if you want it', body: 'Explore membership options at your own pace. You can keep using the free tools.', cta: 'Explore membership', later: 'Not now', never: "Don’t show again" },
  es: { title: 'Más apoyo, si lo deseas', body: 'Conoce las opciones de membresía a tu ritmo. Puedes seguir usando las herramientas gratuitas.', cta: 'Explorar la membresía', later: 'Ahora no', never: 'No volver a mostrar' },
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
  const { i18n } = useTranslation();
  const text = copy[i18n.language?.startsWith('es') ? 'es' : 'en'];
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
      if (show && current()) { owned.current = scope; setShownFor(scope); }
      else if (show) policy.release(scope);
    });
    return () => { active = false; };
  }, [scope, allowed, completed, placement]);
  useEffect(() => () => { if (scope && owned.current === scope) { policy.release(scope); owned.current = null; } }, [scope]);
  if (!allowed || !completed || shownFor !== scope || !scope) return null;
  const dismiss = (permanent: boolean) => {
    setShownFor(null); owned.current = null;
    void policy.dismiss(scope, permanent, () => live.current.scope === scope && live.current.allowed);
  };
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>{text.title}</Text>
    <Text style={styles.body}>{i18n.language?.startsWith('es')
      ? (placement === 'practice-completed' ? 'Ya practicaste una conversación. ¿Te ayudaría contar con práctica continua y orientación para la próxima? Tu resumen sigue siendo gratis.' : 'Guardaste un punto de partida. La membresía puede ayudarte a practicar y ajustar tu enfoque. Tu límite sigue siendo tuyo.')
      : (placement === 'practice-completed' ? 'You practiced a conversation. Would ongoing practice and coaching support help with the next one? Your take-away stays free.' : 'You saved a starting point. Membership can help you practice and adjust your approach. Your boundary remains yours.')}</Text>
    <Text style={styles.body}>{text.body}</Text>
    <Pressable accessibilityRole="button" style={styles.button} onPress={() => {
      if (live.current.scope !== scope || !live.current.allowed) return;
      setShownFor(null); owned.current = null; policy.release(scope); router.push('/membership-guide');
    }}><Text style={styles.link}>{text.cta}</Text></Pressable>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => dismiss(false)}><Text style={styles.link}>{text.later}</Text></Pressable>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => dismiss(true)}><Text style={styles.link}>{text.never}</Text></Pressable>
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
