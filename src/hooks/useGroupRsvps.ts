import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';

export function useGroupRsvps(accountId: string | null) {
  const [rsvpedRooms, setRsvpedRooms] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      if (!accountId) return;
      supabase
        .from('group_rsvps')
        .select('room_name')
        .then(({ data }) => {
          setRsvpedRooms(new Set((data ?? []).map((r) => r.room_name as string)));
        });
    }, [accountId]),
  );

  const toggleRsvp = useCallback(
    async (roomName: string) => {
      if (!accountId) return;
      const isRsvped = rsvpedRooms.has(roomName);
      setRsvpedRooms((prev) => {
        const next = new Set(prev);
        if (isRsvped) next.delete(roomName);
        else next.add(roomName);
        return next;
      });
      if (isRsvped) {
        await supabase
          .from('group_rsvps')
          .delete()
          .eq('account_id', accountId)
          .eq('room_name', roomName);
      } else {
        await supabase
          .from('group_rsvps')
          .upsert({ account_id: accountId, room_name: roomName });
      }
    },
    [accountId, rsvpedRooms],
  );

  return { rsvpedRooms, toggleRsvp };
}
