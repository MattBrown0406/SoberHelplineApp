import type { SupportGroup } from '../api/types';

/** Production catalog for moderated LiveKit groups. Runtime presence comes from Supabase. */
export function getSupportGroups(): SupportGroup[] {
  return [
    {
      id: 'group-parents',
      name: 'Parents of Addicted Young Adults',
      icon: '👨‍👩‍👦',
      accentColor: '#fdf3e3',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: 'Weekly · moderated',
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-parents',
    },
    {
      id: 'group-spouses',
      name: 'Spouses & Partners of Addicted Individuals',
      icon: '💞',
      accentColor: '#fbeae7',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: 'Weekly · moderated',
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-spouses',
    },
    {
      id: 'group-boundaries',
      name: 'Setting & Holding Boundaries',
      icon: '🏰',
      accentColor: '#e8eef5',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: 'Weekly · moderated',
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-boundaries',
    },
    {
      id: 'group-treatment',
      name: 'Finding the Right Treatment Program',
      icon: '🧭',
      accentColor: '#e9f2ec',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: 'Weekly · moderated',
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-treatment',
    },
  ];
}

