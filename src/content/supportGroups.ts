import type { SupportGroup } from '../api/types';

/** Translates a `support` namespace key (the Support tab's `t`). */
export type SupportGroupTranslate = (key: string) => string;

/**
 * Production catalog for moderated LiveKit groups. Runtime presence comes from
 * Supabase. Names and the schedule label are localized (support.json
 * `groups.names.*`, `groups.weeklyModerated`).
 */
export function getSupportGroups(t: SupportGroupTranslate): SupportGroup[] {
  const weekly = t('groups.weeklyModerated');
  return [
    {
      id: 'group-parents',
      name: t('groups.names.parents'),
      icon: '👨‍👩‍👦',
      accentColor: '#fdf3e3',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: weekly,
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-parents',
    },
    {
      id: 'group-spouses',
      name: t('groups.names.spouses'),
      icon: '💞',
      accentColor: '#fbeae7',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: weekly,
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-spouses',
    },
    {
      id: 'group-boundaries',
      name: t('groups.names.boundaries'),
      icon: '🏰',
      accentColor: '#e8eef5',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: weekly,
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-boundaries',
    },
    {
      id: 'group-treatment',
      name: t('groups.names.treatment'),
      icon: '🧭',
      accentColor: '#e9f2ec',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: weekly,
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-treatment',
    },
  ];
}

