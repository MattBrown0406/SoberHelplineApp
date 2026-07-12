import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { FreeTierPaywall } from '../../src/components/ui/FreeTierPaywall';
import { ScriptCard } from '../../src/components/scripts/ScriptCard';
import { getScripts, getDailyScriptPair } from '../../src/content/scripts';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';
import { useLovedOne } from '../../src/hooks/useLovedOne';
import { isAdminEmail } from '../../src/lib/admin';
import type { Script } from '../../src/api/types';

// Light-touch personalization: scripts most relevant to the family's stated
// relationship and substances float to the top of the library. Ranking only —
// nothing is hidden.
const RELEVANCE: Record<string, string[]> = {
  // relationship
  son: ['script-parents-disagree', 'script-housing', 'script-money', 'script-kids'],
  daughter: ['script-parents-disagree', 'script-housing', 'script-money', 'script-kids'],
  spouse: ['script-trust', 'script-kids', 'script-repair', 'script-stolen'],
  partner: ['script-trust', 'script-kids', 'script-repair', 'script-stolen'],
  sibling: ['script-first-convo', 'script-denial', 'script-enabling-family'],
  friend: ['script-first-convo', 'script-denial'],
  parent: ['script-first-convo', 'script-boundary-broken'],
  // substances
  alcohol: ['script-gathering', 'script-impaired', 'script-dui'],
  opioids: ['script-crisis', 'script-relapse', 'script-fear'],
  stimulants: ['script-anger', 'script-suspicion'],
  prescription: ['script-stolen', 'script-borrowed'],
  cannabis: ['script-denial', 'script-promises'],
};

function personalize(scripts: Script[], relationship: string | null, substances: string[]): Script[] {
  const boosted = new Set<string>();
  for (const key of [relationship ?? '', ...substances]) {
    for (const id of RELEVANCE[key] ?? []) boosted.add(id);
  }
  if (boosted.size === 0) return scripts;
  // Stable partition: boosted scripts first, original order preserved within each group.
  return [...scripts.filter((s) => boosted.has(s.id)), ...scripts.filter((s) => !boosted.has(s.id))];
}

export default function ScriptsScreen() {
  const { colors } = useTheme();
  const { user, accountState } = useAccount();
  const { t } = useTranslation('scripts');
  const { t: tCommon } = useTranslation('common');
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState('');

  // Deep links (e.g. Today's "What do you need right now?") pre-fill the search.
  useEffect(() => {
    if (typeof q === 'string' && q.length > 0) setQuery(q);
  }, [q]);

  const { scriptSlot } = useTodayFeed(user?.id ?? null, user?.joinedAt ?? null);
  const { lovedOne } = useLovedOne(user?.id ?? null);

  const allScripts = useMemo(
    () => personalize(getScripts(), lovedOne?.relationship ?? null, lovedOne?.substances ?? []),
    [lovedOne?.relationship, lovedOne?.substances],
  );
  const todayScripts = useMemo(() => getDailyScriptPair(scriptSlot), [scriptSlot]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allScripts;
    return allScripts.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.tag.toLowerCase().includes(q),
    );
  }, [allScripts, query]);

  const firstName = user?.firstName ?? '';
  const isSearching = query.trim().length > 0;

  if (accountState === 'direct-free' && !isAdminEmail(user?.email)) return <FreeTierPaywall />;

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: colors.ink }]}>
          {tCommon('nav.scripts')}
        </Text>
        {firstName ? (
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>
              {firstName.charAt(0).toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Search */}
      <View style={[styles.searchBar, { borderColor: colors.line }]}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={[styles.searchInput, { color: colors.ink }]}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
        />
      </View>

      {isSearching ? (
        /* Search results */
        filtered.length > 0 ? (
          filtered.map((script) => (
            <ScriptCard key={script.id} script={script} />
          ))
        ) : (
          <Text style={[styles.empty, { color: colors.inkSoft }]}>
            {t('noResults')}
          </Text>
        )
      ) : (
        <>
          {/* Today's 2 featured scripts */}
          <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>
            {t('todayEyebrow').toUpperCase()}
          </Text>
          {todayScripts.map((script) => (
            <ScriptCard key={script.id} script={script} />
          ))}

          {/* Full library */}
          <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>
            {t('allEyebrow').toUpperCase()}
          </Text>
          {allScripts.map((script) => (
            <ScriptCard key={script.id} script={script} />
          ))}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  searchBar: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    padding: 0,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  empty: {
    fontSize: 13.5,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 32,
  },
});
