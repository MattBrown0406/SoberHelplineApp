import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface CommunityPost {
  id: string;
  account_id: string;
  author_display: string;
  body: string;
  created_at: string;
  support_count: number;
  mine: boolean;
  /** True when the current member already sent support on this post. */
  supported: boolean;
}

export interface BelongingCount {
  count: number;
  schedule_label: string | null;
}

/** Thrown by createPost when the body trips server-side crisis screening. */
export class CrisisContentError extends Error {
  constructor() {
    super('crisis_content');
    this.name = 'CrisisContentError';
  }
}

export function useCommunity(accountId: string | null) {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [belonging, setBelonging] = useState<BelongingCount>({ count: 0, schedule_label: null });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [postsRes, belongingRes, supportsRes] = await Promise.all([
      supabase
        .from('community_posts')
        .select('id, account_id, author_display, body, created_at, support_count')
        .eq('status', 'visible')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.rpc('upcoming_call_rsvp_count'),
      // RLS limits this to the member's own hearts.
      supabase.from('community_supports').select('post_id'),
    ]);

    const mySupports = new Set(
      ((supportsRes.data ?? []) as { post_id: string }[]).map((r) => r.post_id),
    );
    setPosts(
      ((postsRes.data ?? []) as Omit<CommunityPost, 'mine' | 'supported'>[]).map((p) => ({
        ...p,
        mine: p.account_id === accountId,
        supported: mySupports.has(p.id),
      })),
    );
    if (belongingRes.data) setBelonging(belongingRes.data as BelongingCount);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createPost = useCallback(
    async (body: string): Promise<void> => {
      const { data, error } = await supabase.rpc('create_community_post', { p_body: body });
      if (error) {
        if (error.message.includes('crisis_content')) throw new CrisisContentError();
        throw error;
      }
      if (data) {
        const row = data as Omit<CommunityPost, 'mine' | 'supported' | 'support_count'> & {
          support_count?: number;
        };
        setPosts((prev) => [
          { support_count: 0, ...row, mine: true, supported: false },
          ...prev,
        ]);
      }
    },
    [],
  );

  /** Resolves false (nothing hidden) when the report didn't reach the server. */
  const reportPost = useCallback(async (postId: string, reason?: string): Promise<boolean> => {
    const { error } = await supabase.rpc('report_community_post', { p_post_id: postId, p_reason: reason ?? '' });
    if (error) return false;
    // Drop it from this member's view; the server auto-holds at threshold.
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    return true;
  }, []);

  /** Resolves false and restores the post when the delete didn't go through. */
  const deletePost = useCallback(async (postId: string): Promise<boolean> => {
    let removed: CommunityPost | undefined;
    let index = -1;
    setPosts((prev) => {
      index = prev.findIndex((p) => p.id === postId);
      removed = prev[index];
      return prev.filter((p) => p.id !== postId);
    });
    const { error } = await supabase.from('community_posts').delete().eq('id', postId);
    if (!error) return true;
    if (removed) {
      const restored = removed;
      setPosts((prev) => {
        const next = [...prev];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, restored);
        return next;
      });
    }
    return false;
  }, []);

  /** Send a ❤️ on someone's post. Optimistic; server enforces one per member. */
  const supportPost = useCallback(async (postId: string): Promise<void> => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId && !p.supported
          ? { ...p, supported: true, support_count: p.support_count + 1 }
          : p,
      ),
    );
    await supabase.rpc('support_community_post', { p_post_id: postId });
  }, []);

  return { posts, belonging, loading, createPost, reportPost, deletePost, supportPost, refresh: load };
}
