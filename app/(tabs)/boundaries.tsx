import React, { useCallback, useRef, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { useBoundaries } from '../../src/hooks/useBoundaries';
import { CastleSection } from '../../src/components/boundaries/CastleSection';
import { AnchorCard } from '../../src/components/boundaries/AnchorCard';
import { WallBuilder } from '../../src/components/boundaries/WallBuilder';
import { WallsList } from '../../src/components/boundaries/WallsList';
import enContent from '../../src/locales/en/boundaries.json';
import esContent from '../../src/locales/es/boundaries.json';

type BoundariesContent = typeof enContent;

export default function BoundariesScreen() {
  const { colors } = useTheme();
  const { user, isAttached } = useAccount();
  const { t: tCommon, i18n } = useTranslation('common');
  const { walls, addWall, removeWall } = useBoundaries();

  const content: BoundariesContent = i18n.language.startsWith('es')
    ? esContent
    : enContent;

  const [prefill, setPrefill] = useState('');
  const [lastAnchorTag, setLastAnchorTag] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const handleSuggestionSelect = useCallback((wallText: string, pillId: string) => {
    setPrefill(wallText);
    setLastAnchorTag(pillId);
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 150);
  }, []);

  const handleSave = useCallback(
    async (text: string, tag: string | null) => {
      await addWall(text, tag);
      setPrefill('');
      setLastAnchorTag(null);
    },
    [addWall],
  );

  const firstName = user?.firstName ?? '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: colors.ink }]}>
            {tCommon('nav.boundaries')}
          </Text>
          {firstName ? (
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>
                {firstName.charAt(0).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Castle Framework */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.frameworkEyebrow, { color: colors.primary }]}>
            {content.frameworkEyebrow}
          </Text>
          {content.castleSections.map((section, i) => (
            <CastleSection
              key={section.id}
              section={section}
              isLast={i === content.castleSections.length - 1}
            />
          ))}
        </View>

        {/* Anchor 1 */}
        <AnchorCard
          anchor={content.anchor1}
          onSuggestionSelect={(wallText, pillId) =>
            handleSuggestionSelect(wallText, pillId)
          }
        />

        {/* Anchor 2 */}
        <AnchorCard
          anchor={content.anchor2}
          onSuggestionSelect={(wallText, pillId) =>
            handleSuggestionSelect(wallText, pillId)
          }
        />

        {/* Builder */}
        <WallBuilder
          prefill={prefill}
          onSave={handleSave}
          lastAnchorTag={lastAnchorTag}
        />

        {/* Saved walls */}
        <WallsList
          walls={walls}
          onDelete={removeWall}
          isAttached={isAttached}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  frameworkEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
});
