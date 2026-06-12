import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useRehearsalCount } from '../../hooks/useRehearsalCount';
import type { Script } from '../../api/types';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

interface Props {
  script: Script;
}

export function ScriptCard({ script }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('scripts');
  const router = useRouter();
  const { count } = useRehearsalCount(script.id);
  const [open, setOpen] = useState(false);

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  }

  return (
    <TouchableOpacity
      style={[styles.card, { borderColor: colors.line }]}
      onPress={toggle}
      activeOpacity={0.85}
    >
      {/* Header row */}
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <View
            style={[
              styles.chip,
              {
                backgroundColor: script.tagBackgroundColor,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: script.tagTextColor }]}>
              {script.tag}
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.ink }]}>{script.title}</Text>
        </View>
        <Text
          style={[
            styles.arrow,
            { color: colors.inkSoft },
            open && styles.arrowOpen,
          ]}
        >
          ▶
        </Text>
      </View>

      {/* Body — shown when open */}
      {open && (
        <View style={styles.body}>
          {/* TRY SAYING */}
          <View
            style={[
              styles.block,
              {
                backgroundColor: colors.greenLight,
                borderLeftColor: colors.green,
              },
            ]}
          >
            <Text style={[styles.blockLabel, { color: colors.green }]}>
              {t('trySaying')}
            </Text>
            <Text style={[styles.blockText, { color: colors.ink }]}>
              {script.trySaying}
            </Text>
          </View>

          {/* AVOID */}
          <View
            style={[
              styles.block,
              {
                backgroundColor: colors.coralLight,
                borderLeftColor: colors.coral,
              },
            ]}
          >
            <Text style={[styles.blockLabel, { color: colors.coral }]}>
              {t('avoid')}
            </Text>
            <Text style={[styles.blockText, { color: colors.ink }]}>
              {script.avoid}
            </Text>
          </View>

          {/* Why */}
          <Text style={[styles.why, { color: colors.inkSoft }]}>{script.why}</Text>

          {/* Practice */}
          <TouchableOpacity
            style={[styles.practiceBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
            onPress={() =>
              router.push({
                pathname: '/rehearsal',
                params: {
                  text: script.trySaying,
                  sourceId: script.id,
                  sourceType: 'script',
                },
              })
            }
            activeOpacity={0.85}
          >
            <Text style={[styles.practiceBtnText, { color: colors.primary }]}>
              {t('practice')}
              {count > 0 ? `  ×${count}` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
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
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  headLeft: {
    flex: 1,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 99,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 7,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    fontSize: 14.5,
    lineHeight: 20,
  },
  arrow: {
    fontSize: 13,
    flexShrink: 0,
  },
  arrowOpen: {
    transform: [{ rotate: '90deg' }],
  },
  body: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e0d8',
    borderStyle: 'dashed',
    paddingTop: 12,
    gap: 8,
  },
  block: {
    borderLeftWidth: 3,
    borderRadius: 0,
    // left radius 0, right radius 10
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    padding: 10,
    paddingLeft: 12,
  },
  blockLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 3,
  },
  blockText: {
    fontSize: 13,
    lineHeight: 19,
  },
  why: {
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
    marginTop: 1,
  },
  practiceBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    marginTop: 4,
  },
  practiceBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
