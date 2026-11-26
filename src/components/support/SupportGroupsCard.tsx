import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useAccount } from '../../contexts/AccountContext';
import { appAlert } from '../../lib/appAlert';
import { getSupportGroups } from '../../content/supportGroups';
import { useGroupPresence } from '../../hooks/useGroupPresence';
import { useGroupRsvps } from '../../hooks/useGroupRsvps';
import { useWebSSO } from '../../hooks/useWebSSO';
import { WEBSITE_PATHS } from '../../lib/websiteLinks';
import { plansHref } from '../../lib/membershipPath';
import { isAdminEmail } from '../../lib/admin';
import { COMMUNITY_FEED_VISIBLE } from '../../lib/communityFeed';
import type { SupportGroup } from '../../api/types';
import { supportCard, supportEyebrow } from './cardStyle';

/**
 * The moderated groups (live rooms, "Get notified"), the community feed when
 * it is shown, and, for members, the family forum on soberhelpline.com.
 */
// A free member's group buttons say plainly that they lead to the plans.
export function SupportGroupsCard({ hasMembershipAccess }: { hasMembershipAccess: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const router = useRouter();
  const { user } = useAccount();
  const { openWithSSO } = useWebSSO();
  const groups = getSupportGroups((key) => t(key as never));
  const { myRooms, liveRooms } = useGroupPresence(user?.id ?? null);
  const { rsvpedRooms, pendingRooms, toggleRsvp: toggleGroupRsvp } = useGroupRsvps(user?.id ?? null);
  const isAdmin = isAdminEmail(user?.email);

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text accessibilityRole="header" style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('groups.eyebrow')}
      </Text>
      {groups.map((group: SupportGroup, index: number) => {
        const room = group.liveRoomId;
        // A rule between groups, and under the last one only when the forum
        // link follows it (the community row draws its own).
        const ruleBelow = index < groups.length - 1 || (hasMembershipAccess && !COMMUNITY_FEED_VISIBLE);
        const isMyRoom = !!(isAdmin && room && myRooms.includes(room));
        const isLive = !!(room && liveRooms.includes(room));
        const isRsvped = !!(room && rsvpedRooms.has(room));
        const isRsvpPending = !!(room && pendingRooms.has(room));
        return (
          <View
            key={group.id}
            style={[styles.groupRow, ruleBelow && { borderBottomWidth: 1, borderBottomColor: colors.line }]}
          >
            <View style={[styles.groupIcon, { backgroundColor: group.accentColor }]}>
              <Text style={styles.groupIconText}>{group.icon}</Text>
            </View>
            <View style={styles.groupInfo}>
              <Text style={[styles.groupName, { color: colors.ink }]}>{group.name}</Text>
              <Text style={[styles.groupMeta, { color: colors.inkSoft }]}>
                {group.onlineCount > 0
                  ? `${group.scheduleLabel}  ·  ${t('groups.online', { count: group.onlineCount })}`
                  : group.scheduleLabel}
              </Text>
            </View>
            {/* Status button */}
            {isMyRoom ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`${group.name}: ${t('groups.goLive')}`}
                style={[styles.joinBtn, { borderColor: colors.coral, backgroundColor: colors.coral }]}
                activeOpacity={0.8}
                onPress={() => router.push({ pathname: '/live-room' as never, params: { room: room ?? '' } })}
              >
                <Text style={[styles.joinBtnText, { color: '#fff' }]}>{t('groups.goLive')}</Text>
              </TouchableOpacity>
            ) : !hasMembershipAccess && (isLive || room) ? (
              <TouchableOpacity
                style={[styles.joinBtn, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${group.name}: ${t('plans:invite.cta')}`}
                onPress={() => router.push(plansHref('support_groups', 'essential'))}
              >
                <Text style={[styles.joinBtnText, { color: colors.primary }]}>{t('plans:invite.cta')}</Text>
              </TouchableOpacity>
            ) : isLive ? (
              <TouchableOpacity
                style={[styles.joinBtn, { borderColor: colors.coral, backgroundColor: '#111111' }]}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${group.name}: ${t('groups.joinLive')}`}
                onPress={() => router.push({ pathname: '/live-room' as never, params: { room: room ?? '' } })}
              >
                <Text style={[styles.joinBtnText, { color: '#fff' }]}>{t('groups.joinLive')}</Text>
              </TouchableOpacity>
            ) : room ? (
              <TouchableOpacity
                style={[
                  styles.joinBtn,
                  {
                    borderColor: isRsvped ? colors.green : colors.primary,
                    backgroundColor: isRsvped ? colors.greenLight : colors.primaryLight,
                  },
                ]}
                activeOpacity={0.8}
                disabled={isRsvpPending}
                accessibilityRole="button"
                accessibilityLabel={`${group.name}: ${isRsvped ? t('groups.rsvpDone') : t('groups.rsvpButton')}`}
                accessibilityState={{ disabled: isRsvpPending, selected: isRsvped, busy: isRsvpPending }}
                onPress={async () => {
                  const saved = await toggleGroupRsvp(room);
                  if (saved === 'removed') {
                    appAlert(t('groups.rsvpErrorTitle'), t('groups.removedBody'));
                  } else if (!saved) {
                    appAlert(t('groups.rsvpErrorTitle'), t('groups.rsvpErrorBody'));
                  }
                }}
              >
                {isRsvpPending ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.joinBtnText, { color: isRsvped ? colors.green : colors.primary }]}>
                    {isRsvped ? t('groups.rsvpDone') : t('groups.rsvpButton')}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <View style={[styles.joinBtn, { borderColor: colors.primary, backgroundColor: '#e0e0e0' }]}>
                <Text style={[styles.joinBtnText, { color: '#aaaaaa' }]}>{t('groups.joinButton')}</Text>
              </View>
            )}
          </View>
        );
      })}
      {COMMUNITY_FEED_VISIBLE && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('community.openLink')}
          style={[styles.communityRow, { borderColor: colors.line }]}
          activeOpacity={0.8}
          onPress={() => router.push('/community')}
        >
          <Text style={[styles.communityRowText, { color: colors.ink }]}>
            {t('community.openLink')}
          </Text>
          <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '700' }}>›</Text>
        </TouchableOpacity>
      )}
      {/* The family forum is a members-only soberhelpline.com page: open it
          signed in, and only for members (it would be a website paywall
          for anyone else). */}
      {hasMembershipAccess ? (
        <TouchableOpacity
          style={styles.moreGroupsRow}
          activeOpacity={0.7}
          accessibilityRole="link"
          onPress={() => void openWithSSO(user?.id ?? null, WEBSITE_PATHS.familyForum)}
        >
          <Text style={[styles.moreGroupsText, { color: colors.inkSoft }]}>
            {t('groups.moreIntro')}{' '}
            <Text style={{ color: colors.primary, fontWeight: '700' }}>
              {t('groups.moreLink')}
            </Text>
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: supportCard,
  eyebrow: supportEyebrow,
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  groupIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupIconText: { fontSize: 20 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 14, fontWeight: '600' },
  groupMeta: { fontSize: 12, marginTop: 2 },
  joinBtn: { minHeight: 44, justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  joinBtnText: { fontSize: 12, fontWeight: '600' },
  moreGroupsRow: { minHeight: 44, justifyContent: 'center', paddingTop: 12, alignItems: 'center' },
  moreGroupsText: { fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 14,
  },
  communityRowText: { fontSize: 14, fontWeight: '700' },
});
