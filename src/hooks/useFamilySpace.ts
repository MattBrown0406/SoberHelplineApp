import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FamilySpace, FamilyMember, SharedWall, CommitmentStatus } from '../api/types';

export function useFamilySpace(accountId: string | null) {
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [loading, setLoading] = useState(true);
  const loadGeneration = useRef(0);

  async function loadFull(spaceId: string, generation: number) {
    const [spaceRes, membersRes, wallsRes] = await Promise.all([
      supabase.from('family_spaces').select('id, name, created_by, invite_code').eq('id', spaceId).single(),
      supabase.from('family_members').select('id, account_id, role, joined_at').eq('family_space_id', spaceId),
      supabase
        .from('shared_walls')
        .select('id, text, anchor, proposed_by, created_at, wall_commitments(account_id, status, updated_at)')
        .eq('family_space_id', spaceId)
        .order('created_at', { ascending: true }),
    ]);

    if (generation !== loadGeneration.current || !spaceRes.data) return;

    const members: FamilyMember[] = (membersRes.data ?? []).map((member) => ({
      id: member.id,
      displayName: member.account_id === accountId ? 'You' : 'Member',
      role: member.role as 'owner' | 'member',
      joinedAt: member.joined_at,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharedWalls: SharedWall[] = (wallsRes.data ?? []).map((wall: any) => ({
      id: wall.id,
      familySpaceId: spaceId,
      text: wall.text,
      proposedBy: wall.proposed_by,
      anchor: wall.anchor ?? null,
      createdAt: wall.created_at,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      commitments: (wall.wall_commitments ?? []).map((commitment: any) => ({
        memberId: commitment.account_id,
        status: commitment.status as CommitmentStatus,
        updatedAt: commitment.updated_at,
      })),
    }));

    if (generation !== loadGeneration.current) return;
    setSpace({
      id: spaceRes.data.id,
      name: spaceRes.data.name,
      createdBy: spaceRes.data.created_by,
      inviteCode: spaceRes.data.invite_code,
      members,
      sharedWalls,
    });
  }

  useEffect(() => {
    const generation = ++loadGeneration.current;
    setSpace(null);
    if (!accountId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('family_spaces')
          .select('id')
          .limit(1)
          .maybeSingle();
        if (generation !== loadGeneration.current) return;
        if (error) throw error;
        if (data?.id) await loadFull(data.id, generation);
        else setSpace(null);
      } catch {
        if (generation === loadGeneration.current) setSpace(null);
      } finally {
        if (generation === loadGeneration.current) setLoading(false);
      }
    })();
  }, [accountId]);

  const create = useCallback(async (ownerFirstName: string): Promise<void> => {
    if (!accountId) return;
    const generation = ++loadGeneration.current;
    const { data: spaceId, error } = await supabase.rpc('create_family_space', {
      p_name: `${ownerFirstName}'s Family`,
    });
    if (error || !spaceId) {
      console.error('[useFamilySpace] create_family_space rpc failed:', error);
      throw error ?? new Error('no space id returned');
    }
    if (generation !== loadGeneration.current) return;
    await loadFull(spaceId as string, generation);
  }, [accountId]);

  const joinByCode = useCallback(async (code: string): Promise<boolean> => {
    if (!accountId) return false;
    const generation = ++loadGeneration.current;
    const { data: spaceId, error } = await supabase.rpc('join_family_space', {
      p_invite_code: code,
    });
    if (error || !spaceId) return false;
    if (generation !== loadGeneration.current) return false;
    await loadFull(spaceId as string, generation);
    return generation === loadGeneration.current;
  }, [accountId]);

  return { space, loading, create, joinByCode };
}
