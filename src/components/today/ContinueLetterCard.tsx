import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

const LETTER_PREFIX = '@sh:letter:';

/**
 * Re-entry hook: if the user has an in-progress intervention letter draft,
 * surface it on Today so one tap resumes the work. Renders nothing when no
 * draft exists. Reads the same AsyncStorage keys app/letter.tsx writes.
 */
export function ContinueLetterCard({ accountId }: { accountId: string | null }) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();
  const [recipient, setRecipient] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const prefix = `${LETTER_PREFIX}${accountId}:`;
        const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
        if (cancelled || keys.length === 0) return;
        // Prefer the most recently updated draft.
        let bestName: string | null = null;
        let bestTime = 0;
        for (const key of keys) {
          const raw = await AsyncStorage.getItem(key);
          if (!raw) continue;
          try {
            const draft = JSON.parse(raw) as { recipientName?: string; updatedAt?: string };
            const ts = draft.updatedAt ? Date.parse(draft.updatedAt) : 0;
            if (ts >= bestTime) {
              bestTime = ts;
              bestName = draft.recipientName ?? null;
            }
          } catch {
            // Corrupt draft — ignore.
          }
        }
        if (!cancelled) {
          setHasDraft(true);
          setRecipient(bestName);
        }
      } catch {
        // AsyncStorage failure — just don't show the card.
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  if (!hasDraft) return null;

  return (
    <TouchableOpacity
      style={[styles.card, { borderColor: colors.line }]}
      activeOpacity={0.85}
      onPress={() => router.push('/letter')}
    >
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('continueLetter.eyebrow').toUpperCase()}
      </Text>
      <Text style={[styles.title, { color: colors.ink }]}>
        {recipient
          ? t('continueLetter.title', { name: recipient })
          : t('continueLetter.titleNoName')}
      </Text>
      <Text style={[styles.cta, { color: colors.primary }]}>{t('continueLetter.cta')}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 14.5, fontWeight: '600', marginBottom: 6, lineHeight: 20 },
  cta: { fontSize: 13.5, fontWeight: '700' },
});
