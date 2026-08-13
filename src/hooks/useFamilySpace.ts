import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type {
  FamilyBackupNotice,
  FamilySpace,
  FamilyMember,
  SharedWall,
  CommitmentStatus,
} from '../api/types';

function memberLabel(
  accountId: string,
  viewerId: string | null,
  firstName: string | null | undefined,
  youLabel: string,
): string {
  const name = firstName?.trim();
  if (name) return name;
  return accountId === viewerId ? youLabel : 'Member';
}

export function useFamilySpace(accountId: string | null, youLabel = 'You') {
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [backupNotices, setBackupNotices] = useState<FamilyBackupNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const loadGeneration = useRef(0);

  async function loadFull(spaceId: string, generation: number) {
    const [spaceRes, membersRes, wallsRes, namesRes, waverRes] = await Promise.all([
      supabase.from('family_spaces').select('id, name, created_by, invite_code').eq('id', spaceId).single(),
      supabase.from('family_members').select('id, account_id, role, joined_at').eq('family_space_id', spaceId),
      supabase
        .from('shared_walls')
        .select('id, text, anchor, proposed_by, created_at, wall_commitments(account_id, status, updated_at)')
        .eq('family_space_id', spaceId)
        .order('created_at', { ascending: true }),
      supabase.rpc('family_member_profiles', { p_space_id: spaceId }),
      supabase
        .from('wavering_events')
        .select('id, shared_wall_id, account_id, shared_with_family, created_at')
        .eq('shared_with_family', true)
        .order('created_at', { ascending: false })
        .limit(8),
    ]);

    if (generation !== loadGeneration.current || !spaceRes.data) return;

    const firstNameByAccount = new Map<string, string>(
      ((namesRes.data ?? []) as Array<{ account_id: string; first_name: string | null }>).map((row) => [
        row.account_id,
        row.first_name ?? '',
      ]),
    );

    const members: FamilyMember[] = (membersRes.data ?? []).map((member) => ({
      id: member.id,
      accountId: member.account_id,
      displayName: memberLabel(
        member.account_id,
        accountId,
        firstNameByAccount.get(member.account_id),
        youLabel,
      ),
      role: member.role as 'owner' | 'member',
      joinedAt: member.joined_at,
    }));

    const nameByAccount = new Map(members.map((member) => [member.accountId, member.displayName]));

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

    const wallTextById = new Map(sharedWalls.map((wall) => [wall.id, wall.text]));
    const notices: FamilyBackupNotice[] = ((waverRes.data ?? []) as Array<{
      id: string;
      shared_wall_id: string;
      account_id: string;
      created_at: string;
    }>)
      .filter((row) => wallTextById.has(row.shared_wall_id))
      .map((row) => ({
        id: row.id,
        accountId: row.account_id,
        displayName: nameByAccount.get(row.account_id) ?? youLabel,
        sharedWallId: row.shared_wall_id,
        wallText: wallTextById.get(row.shared_wall_id) ?? '',
        createdAt: row.created_at,
      }));

    if (generation !== loadGeneration.current) return;
    setBackupNotices(notices);
    setSpace({
      id: spaceRes.data.id,
      name: spaceRes.data.name,
      createdBy: spaceRes.data.created_by,
      inviteCode: spaceRes.data.invite_code,
      members,
      sharedWalls,
    });
  }

  const reload = useCallback(async () => {
    if (!accountId) {
      setSpace(null);
      setBackupNotices([]);
      setLoading(false);
      return;
    }
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('family_spaces').select('id').limit(1).maybeSingle();
      if (generation !== loadGeneration.current) return;
      if (error) throw error;
      if (data?.id) await loadFull(data.id, generation);
      else {
        setSpace(null);
        setBackupNotices([]);
      }
    } catch {
      if (generation === loadGeneration.current) {
        setSpace(null);
        setBackupNotices([]);
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [accountId, youLabel]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  const proposeWall = useCallback(async (
    text: string,
    opts?: { anchor?: 'enabling' | 'harm' | 'both' | null; anchorTag?: string | null; sourceWallId?: string | null },
  ): Promise<void> => {
    const { error } = await supabase.rpc('propose_shared_wall', {
      p_text: text,
      p_anchor: opts?.anchor ?? null,
      p_anchor_tag: opts?.anchorTag ?? null,
      p_source_wall_id: opts?.sourceWallId ?? null,
    });
    if (error) throw error;
    await reload();
  }, [reload]);

  const markWavering = useCallback(async (sharedWallId: string, shareWithFamily: boolean): Promise<void> => {
    const { error } = await supabase.rpc('record_wall_wavering', {
      p_shared_wall_id: sharedWallId,
      p_share_with_family: shareWithFamily,
    });
    if (error) throw error;
    if (shareWithFamily) {
      void supabase.functions.invoke('notify-family-backup', { body: { shared_wall_id: sharedWallId } });
    }
    await reload();
  }, [reload]);

  const commitWall = useCallback(async (sharedWallId: string): Promise<void> => {
    if (!accountId) return;
    const { error } = await supabase.from('wall_commitments').upsert(
      {
        shared_wall_id: sharedWallId,
        account_id: accountId,
        status: 'committed',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shared_wall_id,account_id' },
    );
    if (error) throw error;
    await reload();
  }, [accountId, reload]);

  return {
    space,
    backupNotices,
    loading,
    create,
    joinByCode,
    proposeWall,
    markWavering,
    commitWall,
    reload,
  };
}
