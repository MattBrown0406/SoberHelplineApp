import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { ScriptCard } from '../../src/components/scripts/ScriptCard';
import { getScripts, getDailyScripts, SCRIPT_CATEGORIES } from '../../src/content/scripts';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';
import { useLovedOne } from '../../src/hooks/useLovedOne';
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
  const { user } = useAccount();
  const { t, i18n } = useTranslation('scripts');
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
    () => personalize(getScripts(i18n.language), lovedOne?.relationship ?? null, lovedOne?.substances ?? []),
    [lovedOne?.relationship, lovedOne?.substances, i18n.language],
  );
  const todayScripts = useMemo(
    () => getDailyScripts(scriptSlot, i18n.language),
    [scriptSlot, i18n.language],
  );

  // Shelves: the full library grouped into a short index, collapsed by
  // default. Personalized order is preserved within each shelf.
  const shelves = useMemo(() => {
    const tagToKey = new Map<string, string>();
    for (const cat of SCRIPT_CATEGORIES) {
      for (const tag of cat.tags) tagToKey.set(tag, cat.key);
    }
    const byKey = new Map<string, Script[]>();
    for (const script of allScripts) {
      const key = tagToKey.get(script.tag) ?? 'other';
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(script);
    }
    const ordered = SCRIPT_CATEGORIES
      .map((cat) => ({ key: cat.key, scripts: byKey.get(cat.key) ?? [] }))
      .filter((shelf) => shelf.scripts.length > 0);
    const other = byKey.get('other');
    if (other && other.length > 0) ordered.push({ key: 'other', scripts: other });
    return ordered;
  }, [allScripts]);

  const [openShelves, setOpenShelves] = useState<Record<string, boolean>>({});

  function toggleShelf(key: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenShelves((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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
          {/* Today's 3 featured scripts */}
          <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>
            {t('todayEyebrow').toUpperCase()}
          </Text>
          {todayScripts.map((script) => (
            <ScriptCard key={script.id} script={script} />
          ))}
          <Text style={[styles.freshNote, { color: colors.inkSoft }]}>
            {t('freshTomorrow')}
          </Text>

          {/* Full library as collapsed shelves */}
          <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>
            {t('allEyebrow').toUpperCase()}
          </Text>
          {shelves.map((shelf) => {
            const isOpen = !!openShelves[shelf.key];
            return (
              <View key={shelf.key}>
                <TouchableOpacity
                  style={[styles.shelfHead, { borderColor: colors.line }]}
                  onPress={() => toggleShelf(shelf.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.shelfTitle, { color: colors.ink }]}>
                    {t(`categories.${shelf.key}`)}
                  </Text>
                  <View style={styles.shelfRight}>
                    <View style={[styles.shelfCount, { backgroundColor: colors.cream }]}>
                      <Text style={[styles.shelfCountText, { color: colors.inkSoft }]}>
                        {shelf.scripts.length}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.shelfArrow,
                        { color: colors.inkSoft },
                        isOpen && styles.shelfArrowOpen,
                      ]}
                    >
                      ▶
                    </Text>
                  </View>
                </TouchableOpacity>
                {isOpen && (
                  <View style={styles.shelfBody}>
                    {shelf.scripts.map((script) => (
                      <ScriptCard key={script.id} script={script} />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
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
  freshNote: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 18,
    marginTop: 2,
  },
  shelfHead: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  shelfTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    flex: 1,
  },
  shelfRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shelfCount: {
    borderRadius: 99,
    minWidth: 26,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  shelfCountText: {
    fontSize: 12,
    fontWeight: '700',
  },
  shelfArrow: {
    fontSize: 12,
  },
  shelfArrowOpen: {
    transform: [{ rotate: '90deg' }],
  },
  shelfBody: {
    paddingLeft: 6,
    marginBottom: 4,
  },
});
