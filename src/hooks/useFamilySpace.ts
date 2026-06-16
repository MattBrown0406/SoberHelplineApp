import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FamilySpace, FamilyMember, SharedWall, CommitmentStatus } from '../api/types';

export function useFamilySpace(accountId: string | null) {
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) { setLoading(false); return; }
    void load();
  }, [accountId]);

  async function load() {
    setLoading(true);
    // family_spaces RLS returns only spaces this account is a member of
    const { data } = await supabase
      .from('family_spaces')
      .select('id')
      .limit(1)
      .maybeSingle();
    if (data?.id) await loadFull(data.id);
    setLoading(false);
  }

  async function loadFull(spaceId: string) {
    const [spaceRes, membersRes, wallsRes] = await Promise.all([
      supabase
        .from('family_spaces')
        .select('id, name, created_by, invite_code')
        .eq('id', spaceId)
        .single(),
      supabase
        .from('family_members')
        .select('id, account_id, role, joined_at')
        .eq('family_space_id', spaceId),
      supabase
        .from('shared_walls')
        .select('id, text, anchor, proposed_by, created_at, wall_commitments(account_id, status, updated_at)')
        .eq('family_space_id', spaceId)
        .order('created_at', { ascending: true }),
    ]);

    if (!spaceRes.data) return;

    const members: FamilyMember[] = (membersRes.data ?? []).map((m) => ({
      id: m.id,
      displayName: m.account_id === accountId ? 'You' : 'Member',
      role: m.role as 'owner' | 'member',
      joinedAt: m.joined_at,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharedWalls: SharedWall[] = (wallsRes.data ?? []).map((w: any) => ({
      id: w.id,
      familySpaceId: spaceId,
      text: w.text,
      proposedBy: w.proposed_by,
      anchor: w.anchor ?? null,
      createdAt: w.created_at,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      commitments: (w.wall_commitments ?? []).map((c: any) => ({
        memberId: c.account_id,
        status: c.status as CommitmentStatus,
        updatedAt: c.updated_at,
      })),
    }));

    setSpace({
      id: spaceRes.data.id,
      name: spaceRes.data.name,
      createdBy: spaceRes.data.created_by,
      inviteCode: spaceRes.data.invite_code,
      members,
      sharedWalls,
    });
  }

  const create = useCallback(async (ownerFirstName: string): Promise<void> => {
    if (!accountId) return;
    // Single atomic RPC: inserts family_spaces + family_members in one transaction
    // as SECURITY DEFINER, avoiding the RLS chicken-and-egg problem.
    const { data: spaceId, error } = await supabase.rpc('create_family_space', {
      p_name: `${ownerFirstName}'s Family`,
    });
    if (error || !spaceId) {
      console.error('[useFamilySpace] create_family_space rpc failed:', error);
      throw error ?? new Error('no space id returned');
    }
    await loadFull(spaceId as string);
  }, [accountId]);

  const joinByCode = useCallback(async (code: string): Promise<boolean> => {
    const { data: spaceId, error } = await supabase.rpc('join_family_space', {
      p_invite_code: code,
    });
    if (error || !spaceId) return false;
    await loadFull(spaceId as string);
    return true;
  }, []);

  return { space, loading, create, joinByCode };
}
