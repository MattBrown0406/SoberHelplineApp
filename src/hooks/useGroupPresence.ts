import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';

interface GroupPresence {
  myRooms: string[];   // rooms where the current account is a host
  liveRooms: string[]; // rooms currently marked is_live = true
  isLoading: boolean;
}

export function useGroupPresence(accountId: string | null): GroupPresence {
  const [myRooms, setMyRooms] = useState<string[]>([]);
  const [liveRooms, setLiveRooms] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!accountId) return;
      let active = true;

      async function load() {
        setIsLoading(true);
        const [mine, live] = await Promise.all([
          supabase
            .from('group_hosts')
            .select('room_name')
            .eq('account_id', accountId),
          supabase
            .from('group_hosts')
            .select('room_name')
            .eq('is_live', true),
        ]);
        if (!active) return;
        setMyRooms((mine.data ?? []).map((r) => r.room_name));
        setLiveRooms((live.data ?? []).map((r) => r.room_name));
        setIsLoading(false);
      }

      load();
      return () => { active = false; };
    }, [accountId]),
  );

  return { myRooms, liveRooms, isLoading };
}
