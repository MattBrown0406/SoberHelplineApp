import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from './usePushNotifications';

export function useGroupRsvps(accountId: string | null) {
  const [rsvpedRooms, setRsvpedRooms] = useState<Set<string>>(new Set());
  const [pendingRooms, setPendingRooms] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      if (!accountId) {
        setRsvpedRooms(new Set());
        return;
      }
      let active = true;
      void supabase
        .from('group_rsvps')
        .select('room_name')
        .then(({ data, error }) => {
          if (!active) return;
          if (error) {
            console.warn('[group-rsvp] load failed', error.message);
            return;
          }
          setRsvpedRooms(new Set((data ?? []).map((r) => r.room_name as string)));
        });
      return () => {
        active = false;
      };
    }, [accountId]),
  );

  const toggleRsvp = useCallback(
    /** true = saved; false = failed; 'removed' = the host removed this member from live groups. */
    async (roomName: string): Promise<boolean | 'removed'> => {
      if (!accountId || pendingRooms.has(roomName)) return false;
      const nextEnabled = !rsvpedRooms.has(roomName);
      setPendingRooms((prev) => new Set(prev).add(roomName));
      try {
        const { data, error } = await supabase.rpc('set_group_rsvp', {
          p_room_name: roomName,
          p_enabled: nextEnabled,
        });
        if (error) throw error;
        if (data !== nextEnabled) throw new Error('Unexpected RSVP response');
        setRsvpedRooms((prev) => {
          const next = new Set(prev);
          if (nextEnabled) next.add(roomName);
          else next.delete(roomName);
          return next;
        });
        if (nextEnabled) {
          // Reminder delivery is optional; declining notifications must not undo
          // or block the reservation itself.
          void registerForPushNotifications(accountId).catch(() => false);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message
          : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : 'unknown';
        if (message.includes('removed_from_live_groups')) return 'removed';
        console.warn('[group-rsvp] update failed', message);
        return false;
      } finally {
        setPendingRooms((prev) => {
          const next = new Set(prev);
          next.delete(roomName);
          return next;
        });
      }
    },
    [accountId, pendingRooms, rsvpedRooms],
  );

  return { rsvpedRooms, pendingRooms, toggleRsvp };
}
