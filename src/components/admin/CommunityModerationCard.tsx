import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
};

/** Admin-only: community posts members reported, or the system held after 3 reports. */
export function CommunityModerationCard() {
  const { colors } = useTheme();
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

  function confirmRemove(post: ReportedPost) {
    appAlert('Remove this post?', 'It will be hidden from the community for good.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => moderate(post, 'removed') },
    ]);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>Community reports</Text>
      {posts === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : failed ? (
        <Text style={[styles.note, { color: colors.coral }]}>Could not load reported posts.</Text>
      ) : posts.length === 0 ? (
        <Text style={[styles.note, { color: colors.inkSoft }]}>No reported posts.</Text>
      ) : (
        posts.map((post) => (
          <View key={post.post_id} style={[styles.row, { borderTopColor: colors.line }]}>
            <Text style={[styles.meta, { color: post.status === 'held' ? colors.coral : colors.inkSoft }]}>
              {post.status === 'held' ? 'Held (hidden)' : 'Visible'} · {post.report_count} report{post.report_count === 1 ? '' : 's'}
              {post.author_name ? ` · ${post.author_name}` : ''} · {new Date(post.created_at).toLocaleDateString()}
            </Text>
            <Text style={[styles.body, { color: colors.ink }]}>{post.body}</Text>
            {post.reasons.length > 0 ? (
              <Text style={[styles.note, { color: colors.inkSoft }]}>Reasons: {post.reasons.slice(0, 3).join(' · ')}</Text>
            ) : null}
            <View style={styles.actions}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={busy === post.post_id}
                onPress={() => void moderate(post, 'visible')}
                style={[styles.button, { borderColor: colors.primary }]}
              >
                <Text style={[styles.buttonText, { color: colors.primary }]}>Keep / restore</Text>
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
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  buttonText: { fontSize: 13, fontWeight: '800' },
  refresh: { marginTop: 8, alignSelf: 'flex-start', paddingVertical: 6 },
});
