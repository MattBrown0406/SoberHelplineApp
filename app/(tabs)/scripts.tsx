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
import { ScriptCard } from '../../src/components/scripts/ScriptCard';
import { getScripts, getDailyScripts, SCRIPT_CATEGORIES } from '../../src/content/scripts';
import type { Script } from '../../src/api/types';

/** A local calendar day always maps to the same bundled daily set. */
export function localDailyScriptSlot(date = new Date()): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export default function ScriptsScreen() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('scripts');
  const { t: tCommon } = useTranslation('common');
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState('');

  // Deep links (e.g. Today's "What do you need right now?") pre-fill the search.
  useEffect(() => {
    if (typeof q === 'string' && q.length > 0) setQuery(q);
  }, [q]);

  // Both the library and rotation are bundled. Opening this route performs no
  // account, loved-one, feed, or Supabase request.
  const allScripts = useMemo(() => getScripts(i18n.language), [i18n.language]);
  const todayScripts = useMemo(
    () => getDailyScripts(localDailyScriptSlot(), i18n.language),
    [i18n.language],
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
    return allScripts.filter((script) => {
      const categoryKey = SCRIPT_CATEGORIES.find((category) => category.tags.includes(script.tag))?.key ?? 'other';
      const haystack = [
        script.title,
        script.tag,
        t(`tags.${script.tag}`),
        t(`categories.${categoryKey}`),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [allScripts, i18n.language, query, t]);

  const isSearching = query.trim().length > 0;


  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <View style={styles.headerRow}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
          {tCommon('nav.scripts')}
        </Text>
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
          accessibilityLabel={t('searchPlaceholder')}
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
                  accessibilityRole="button"
                  accessibilityLabel={`${t(`categories.${shelf.key}`)}, ${shelf.scripts.length}`}
                  accessibilityHint={isOpen
                    ? (i18n.language.startsWith('es') ? 'Contrae esta categoría de guiones' : 'Collapses this script category')
                    : (i18n.language.startsWith('es') ? 'Expande esta categoría de guiones' : 'Expands this script category')}
                  accessibilityState={{ expanded: isOpen }}
                >
                  <Text style={[styles.shelfTitle, { color: colors.ink }]}>
                    {t(`categories.${shelf.key}`)}
                  </Text>
                  <View style={styles.shelfRight} accessible={false}>
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
    minHeight: 44,
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
