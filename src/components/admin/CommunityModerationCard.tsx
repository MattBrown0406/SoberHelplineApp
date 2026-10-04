import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';
import { appAlert } from '../../lib/appAlert';

type ReportedPost = {
  post_id: string;
  body: string;
  status: 'visible' | 'held';
  report_count: number;
  reasons: string[];
  author_name: string | null;
  created_at: string;
  /** Mentions suicide, an overdose or self-harm and hasn't been reviewed yet. */
  crisis?: boolean;
  author_account_id?: string | null;
  author_email?: string | null;
};

/**
 * Admin-only: community posts members reported, posts the system held after 3
 * reports, and posts that mentioned a crisis (check on the author; "Keep" marks
 * it reviewed).
 */
export function CommunityModerationCard() {
  const { colors } = useTheme();
  const router = useRouter();
  const [posts, setPosts] = useState<ReportedPost[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_reported_community_posts');
    setFailed(!!error);
    setPosts(error ? [] : ((data ?? []) as ReportedPost[]));
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function moderate(post: ReportedPost, status: 'visible' | 'removed') {
    setBusy(post.post_id);
    const { error } = await supabase.rpc('moderate_community_post', { p_post_id: post.post_id, p_status: status });
    setBusy(null);
    if (error) appAlert('Could not update the post', error.message);
    else void load();
  }

  async function messageAuthor(post: ReportedPost) {
    if (!post.author_account_id) return;
    setBusy(post.post_id);
    const { data: threadId, error } = await supabase.rpc('admin_get_or_create_thread', {
      p_account_id: post.author_account_id,
    });
    setBusy(null);
    if (error || typeof threadId !== 'string') {
      appAlert('Could not open a conversation', error?.message ?? 'Try again.');
      return;
    }
    router.push({ pathname: '/admin-thread' as never, params: { threadId } });
  }

  function confirmRemove(post: ReportedPost) {
    appAlert('Remove this post?', 'It will be hidden from the community for good.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => moderate(post, 'removed') },
    ]);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>Community reports and check-ins</Text>
      {posts === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : failed ? (
        <Text style={[styles.note, { color: colors.coral }]}>Could not load reported posts.</Text>
      ) : posts.length === 0 ? (
        <Text style={[styles.note, { color: colors.inkSoft }]}>Nothing to review.</Text>
      ) : (
        posts.map((post) => (
          <View key={post.post_id} style={[styles.row, { borderTopColor: colors.line }]}>
            {post.crisis ? (
              <Text style={[styles.meta, { color: colors.coral }]}>
                🆘 Mentions a crisis — check on {post.author_name ?? 'the author'}
              </Text>
            ) : null}
            <Text style={[styles.meta, { color: post.status === 'held' ? colors.coral : colors.inkSoft }]}>
              {post.status === 'held' ? 'Held (hidden)' : 'Visible'} · {post.report_count} report{post.report_count === 1 ? '' : 's'}
              {post.author_name ? ` · ${post.author_name}` : ''} · {new Date(post.created_at).toLocaleDateString()}
            </Text>
            <Text style={[styles.body, { color: colors.ink }]}>{post.body}</Text>
            {post.reasons.length > 0 ? (
              <Text style={[styles.note, { color: colors.inkSoft }]}>Reasons: {post.reasons.slice(0, 3).join(' · ')}</Text>
            ) : null}
            {post.crisis && post.author_email ? (
              <Text
                accessibilityRole="link"
                onPress={() => void Linking.openURL(`mailto:${post.author_email}`)}
                style={[styles.note, { color: colors.primary }]}
              >
                {post.author_email}
              </Text>
            ) : null}
            <View style={styles.actions}>
              {post.crisis && post.author_account_id ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={busy === post.post_id}
                  onPress={() => void messageAuthor(post)}
                  style={[styles.button, { borderColor: colors.primary }]}
                >
                  <Text style={[styles.buttonText, { color: colors.primary }]}>Message her</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                accessibilityRole="button"
                disabled={busy === post.post_id}
                onPress={() => void moderate(post, 'visible')}
                style={[styles.button, { borderColor: colors.primary }]}
              >
                <Text style={[styles.buttonText, { color: colors.primary }]}>{post.crisis && post.report_count === 0 && post.status === 'visible' ? 'Reviewed' : 'Keep / restore'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={busy === post.post_id}
                onPress={() => confirmRemove(post)}
                style={[styles.button, { borderColor: colors.coral }]}
              >
                {busy === post.post_id
                  ? <ActivityIndicator size="small" color={colors.coral} />
                  : <Text style={[styles.buttonText, { color: colors.coral }]}>Remove</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
      <TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={styles.refresh}>
        <Text style={[styles.buttonText, { color: colors.primary }]}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 20, marginBottom: 20 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  row: { borderTopWidth: 1, paddingVertical: 12, gap: 6 },
  meta: { fontSize: 12, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  note: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  button: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  buttonText: { fontSize: 13, fontWeight: '800' },
  refresh: { marginTop: 8, alignSelf: 'flex-start', paddingVertical: 6 },
});
