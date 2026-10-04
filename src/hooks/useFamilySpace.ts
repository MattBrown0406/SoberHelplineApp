import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { familyJoinFailure, type FamilyJoinResult } from '../lib/inviteCodeErrors';
import {
  requestFamilySpaceRefresh,
  shouldRefreshFamilySpace,
  subscribeFamilySpaceRefresh,
} from '../lib/familySpaceRefresh';
import type {
  FamilyBackupNotice,
  FamilySpace,
  FamilyMember,
  SharedWall,
  CommitmentStatus,
} from '../api/types';

export type FamilySpaceLabels = { you: string; member: string };

/**
 * `family_spaces.name` stores the owner's first name only (language-neutral);
 * screens format it with a locale key. Rows written before this change stored
 * "<name>'s Family", so the legacy suffix is stripped when reading.
 */
export function familySpaceOwnerName(storedName: string | null | undefined): string {
  return (storedName ?? '').replace(/['’]s Family$/i, '').trim();
}

function memberLabel(
  accountId: string,
  viewerId: string | null,
  firstName: string | null | undefined,
  labels: FamilySpaceLabels,
): string {
  const name = firstName?.trim();
  if (name) return name;
  return accountId === viewerId ? labels.you : labels.member;
}

export function useFamilySpace(accountId: string | null, labels: FamilySpaceLabels) {
  const { you: youLabel, member: memberFallback } = labels;
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [backupNotices, setBackupNotices] = useState<FamilyBackupNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const loadGeneration = useRef(0);
  const lastLoadStartedAt = useRef<number | null>(null);
  // Identifies this copy so its own change notice does not re-read it twice.
  const [instanceId] = useState(() => Math.random().toString(36).slice(2));

  /** `strict`: a partial read throws instead of showing a space with missing members or walls. */
  async function loadFull(spaceId: string, generation: number, strict = false) {
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

    if (generation !== loadGeneration.current) return;
    const readError = spaceRes.error ?? membersRes.error ?? wallsRes.error;
    if (strict && readError) throw readError;
    if (!spaceRes.data) return;

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
        { you: youLabel, member: memberFallback },
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
        // Someone who has since left the space is "a family member", never "You".
        displayName: nameByAccount.get(row.account_id) ?? (row.account_id === accountId ? youLabel : memberFallback),
        sharedWallId: row.shared_wall_id,
        wallText: wallTextById.get(row.shared_wall_id) ?? '',
        createdAt: row.created_at,
      }));

    if (generation !== loadGeneration.current) return;
    setBackupNotices(notices);
    setSpace({
      id: spaceRes.data.id,
      name: spaceRes.data.name,
      ownerName: familySpaceOwnerName(spaceRes.data.name),
      createdBy: spaceRes.data.created_by,
      inviteCode: spaceRes.data.invite_code,
      members,
      sharedWalls,
    });
  }

  /**
   * `silent`: a background re-read (focus, foreground, another screen's
   * change) — no loading state, and a failed read keeps what is on screen.
   */
  const load = useCallback(async (silent: boolean) => {
    if (!accountId) {
      setSpace(null);
      setBackupNotices([]);
      setLoading(false);
      return;
    }
    const generation = ++loadGeneration.current;
    lastLoadStartedAt.current = Date.now();
    if (!silent) setLoading(true);
    try {
      // A member belongs to at most one family space (unique membership).
      const { data, error } = await supabase
        .from('family_members')
        .select('family_space_id')
        .eq('account_id', accountId)
        .maybeSingle();
      if (generation !== loadGeneration.current) return;
      if (error) throw error;
      if (data?.family_space_id) await loadFull(data.family_space_id, generation, silent);
      else {
        setSpace(null);
        setBackupNotices([]);
      }
    } catch {
      if (!silent && generation === loadGeneration.current) {
        setSpace(null);
        setBackupNotices([]);
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [accountId, youLabel, memberFallback]);

  const reload = useCallback(() => load(false), [load]);

  /**
   * Re-read in the background (screen focus, app foreground). Skipped when a
   * read started moments ago unless `force`; a failure keeps the current space.
   */
  const refresh = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force && !shouldRefreshFamilySpace(lastLoadStartedAt.current)) return;
    await load(true);
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Relatives change the space from their own phones: re-read on foreground,
  // and whenever another screen (or a family_backup tap) says it changed.
  useEffect(() => {
    if (!accountId) return;
    const unsubscribe = subscribeFamilySpaceRefresh((source) => {
      if (source !== instanceId) void load(true);
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [accountId, instanceId, load, refresh]);

  /** Tell the other mounted copy (Today or Boundaries) that the space changed. */
  const announceChange = useCallback(() => requestFamilySpaceRefresh(instanceId), [instanceId]);

  /**
   * The space's member count read fresh from the server (null when it cannot
   * be read), e.g. right before leaving: a now-alone owner must be told that
   * leaving deletes the space.
   */
  const fetchMemberCount = useCallback(async (spaceId: string): Promise<number | null> => {
    try {
      const { count, error } = await supabase
        .from('family_members')
        .select('id', { count: 'exact', head: true })
        .eq('family_space_id', spaceId);
      return error || typeof count !== 'number' ? null : count;
    } catch {
      return null;
    }
  }, []);

  const create = useCallback(async (ownerFirstName: string): Promise<void> => {
    if (!accountId) return;
    const generation = ++loadGeneration.current;
    const { data: spaceId, error } = await supabase.rpc('create_family_space', {
      p_name: ownerFirstName.trim(),
    });
    if (error || !spaceId) {
      console.error('[useFamilySpace] create_family_space rpc failed:', error);
      throw error ?? new Error('no space id returned');
    }
    if (generation !== loadGeneration.current) return;
    await loadFull(spaceId as string, generation);
    announceChange();
  }, [accountId, announceChange]);

  /**
   * Join with a family invite code. A refusal says why (unknown code, too many
   * attempts, already in another family space, or a network/server error) so
   * the screen can say something more useful than "invalid code".
   */
  const joinByCode = useCallback(async (code: string): Promise<FamilyJoinResult> => {
    if (!accountId) return { ok: false, reason: 'error' };
    const generation = ++loadGeneration.current;
    let spaceId: unknown = null;
    try {
      const result = await supabase.rpc('join_family_space', {
        p_invite_code: code,
      });
      const failure = familyJoinFailure(result.error, result.data);
      if (failure) return { ok: false, reason: failure };
      spaceId = result.data;
    } catch {
      return { ok: false, reason: 'error' };
    }
    announceChange();
    // The join itself succeeded; a newer load owns the visible state now.
    if (generation !== loadGeneration.current) return { ok: true };
    await loadFull(spaceId as string, generation);
    return { ok: true };
  }, [accountId, announceChange]);

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
    announceChange();
  }, [reload, announceChange]);

  /** Leaves the current family space (an owner hands it to the next member). */
  const leave = useCallback(async (): Promise<void> => {
    const { error } = await supabase.rpc('leave_family_space');
    if (error) throw error;
    await reload();
    announceChange();
  }, [reload, announceChange]);

  const markWavering = useCallback(async (sharedWallId: string, shareWithFamily: boolean): Promise<void> => {
    const { data: eventId, error } = await supabase.rpc('record_wall_wavering', {
      p_shared_wall_id: sharedWallId,
      p_share_with_family: shareWithFamily,
    });
    if (error) throw error;
    if (shareWithFamily && eventId) {
      void supabase.functions.invoke('notify-family-backup', {
        body: { wavering_event_id: eventId },
      });
    }
    await reload();
    announceChange();
  }, [reload, announceChange]);

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
    announceChange();
  }, [accountId, reload, announceChange]);

  return {
    space,
    backupNotices,
    loading,
    create,
    joinByCode,
    proposeWall,
    markWavering,
    commitWall,
    leave,
    reload,
    refresh,
    fetchMemberCount,
  };
}
