import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
} from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { ScriptCard } from '../../src/components/scripts/ScriptCard';
import { getMockScripts, getDailyScriptPair } from '../../src/api/mock';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';

export default function ScriptsScreen() {
  const { colors } = useTheme();
  const { user } = useAccount();
  const { t } = useTranslation('scripts');
  const { t: tCommon } = useTranslation('common');
  const [query, setQuery] = useState('');

  const { scriptSlot } = useTodayFeed(user?.id ?? null, user?.joinedAt ?? null);

  const allScripts = useMemo(() => getMockScripts(), []);
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
