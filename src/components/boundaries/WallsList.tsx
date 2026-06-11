import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { BoundaryWall } from '../../api/types';

interface Props {
  walls: BoundaryWall[];
  onDelete: (id: string) => void;
  isAttached: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function WallsList({ walls, onDelete, isAttached }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('boundaries');

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>
        {t('walls.eyebrow')}
      </Text>

      {walls.length === 0 ? (
        <Text style={[styles.empty, { color: colors.inkSoft }]}>
          {t('walls.empty')}
        </Text>
      ) : (
        <>
          {walls.map((wall) => (
            <View
              key={wall.id}
              style={[styles.wallItem, { borderColor: colors.line, backgroundColor: colors.cream }]}
            >
              <Text style={styles.wallIcon}>⚓</Text>
              <View style={styles.wallBody}>
                <Text style={[styles.wallText, { color: colors.ink }]}>
                  {wall.text}
                </Text>
                <Text style={[styles.wallDate, { color: colors.inkSoft }]}>
                  {formatDate(wall.createdAt)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onDelete(wall.id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.deleteBtn, { color: colors.inkSoft }]}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            style={[styles.shareBtn, { borderColor: colors.primary }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.shareBtnText, { color: colors.primary }]}>
              {isAttached ? t('walls.shareAttached') : t('walls.shareDirect')}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  empty: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
  },
  wallItem: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  wallIcon: {
    fontSize: 16,
    marginTop: 1,
  },
  wallBody: {
    flex: 1,
    gap: 3,
  },
  wallText: {
    fontSize: 13.5,
    lineHeight: 20,
  },
  wallDate: {
    fontSize: 11.5,
  },
  deleteBtn: {
    fontSize: 13,
    paddingTop: 2,
  },
  shareBtn: {
    borderWidth: 1.5,
    borderRadius: 99,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 4,
  },
  shareBtnText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
});
