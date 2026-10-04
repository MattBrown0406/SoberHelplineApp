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

/** Someone the member blocked (shown by the name the feed showed). */
export interface CommunityBlock {
  block_id: string;
  display_name: string;
  blocked_at: string;
}

export interface CreatePostResult {
  /** The post mentions suicide, self-harm or an overdose: show the author 988/911. */
  safetyResources: boolean;
}

export interface BelongingCount {
  count: number;
  schedule_label: string | null;
  /** Which session (newer servers): lets the app localize the Family Squares time. */
  title?: string | null;
  next_at?: string | null;
}

/** Thrown by createPost after too many posts in an hour. */
export class PostRateLimitedError extends Error {
  constructor() {
    super('rate_limited');
    this.name = 'PostRateLimitedError';
  }
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
  const [blocks, setBlocks] = useState<CommunityBlock[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBlocks = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_community_blocks');
    if (!error) setBlocks((data ?? []) as CommunityBlock[]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    // The server leaves out posts this member reported and people she blocked.
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
      loadBlocks(),
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
  }, [accountId, loadBlocks]);

  useEffect(() => {
    void load();
  }, [load]);

  const createPost = useCallback(
    /** past: she confirmed a refused post is about something that already happened. */
    async (body: string, past = false): Promise<CreatePostResult> => {
      const { data, error } = await supabase.rpc('create_community_post', { p_body: body, p_past: past });
      if (error) {
        if (error.message.includes('crisis_content')) throw new CrisisContentError();
        if (error.message.includes('rate_limited')) throw new PostRateLimitedError();
        throw error;
      }
      if (!data) return { safetyResources: false };
      const { safety_resources: safetyResources, ...row } = data as Omit<CommunityPost, 'mine' | 'supported' | 'support_count'> & {
        support_count?: number;
        safety_resources?: boolean;
      };
      setPosts((prev) => [
        { support_count: 0, ...row, mine: true, supported: false },
        ...prev,
      ]);
      return { safetyResources: safetyResources === true };
    },
    [],
  );

  /** Resolves false (nothing hidden) when the report didn't reach the server. */
  const reportPost = useCallback(async (postId: string, reason?: string): Promise<boolean> => {
    const { error } = await supabase.rpc('report_community_post', { p_post_id: postId, p_reason: reason ?? '' });
    if (error) return false;
    // Drop it from this member's view (the server keeps it out of her feed
    // from now on); the server auto-holds it for everyone at threshold.
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    return true;
  }, []);

  /** Blocks the post's author: none of her posts appear again. Resolves false if it didn't go through. */
  const blockAuthor = useCallback(async (post: CommunityPost): Promise<boolean> => {
    const { error } = await supabase.rpc('block_community_author', { p_post_id: post.id });
    if (error) return false;
    setPosts((prev) => prev.filter((p) => p.account_id !== post.account_id));
    await loadBlocks();
    return true;
  }, [loadBlocks]);

  /** Lifts a block; that person's posts come back on the refreshed feed. */
  const unblock = useCallback(async (blockId: string): Promise<boolean> => {
    const { error } = await supabase.rpc('unblock_community_author', { p_block_id: blockId });
    if (error) return false;
    setBlocks((prev) => prev.filter((b) => b.block_id !== blockId));
    void load();
    return true;
  }, [load]);

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

  return {
    posts, belonging, blocks, loading, createPost, reportPost, deletePost, supportPost, blockAuthor, unblock, refresh: load,
  };
}
