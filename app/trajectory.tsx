import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useTrajectory, type WeekPoint } from '../src/hooks/useTrajectory';
import { useThread } from '../src/hooks/useThread';
import { supabase } from '../src/lib/supabase';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';

const CONSENT_SHARE_CHECKINS = '2';
const SELF_CHECK_COUNT = 5;
const SELF_CHECK_THRESHOLD = 3;
const BAR_MAX_H = 64;

function weekLabel(week: string): string {
  const d = new Date(week + 'T12:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export default function TrajectoryScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('tracker');
  const { user } = useAccount();
  const router = useRouter();

  const { points, trend, loading } = useTrajectory(user?.id ?? null, 6);
  const { send } = useThread(user?.id ?? null);

  const [checked, setChecked] = useState<boolean[]>(Array(SELF_CHECK_COUNT).fill(false));
  const [shareConsent, setShareConsent] = useState(false);
  const [shared, setShared] = useState(false);

  const items = useMemo(
    () => t('trajectory.selfCheckItems', { returnObjects: true }) as string[],
    [t],
  );

  useEffect(() => {
    if (!user?.id) return;
    void supabase
      .from('consents')
      .select('granted_at, revoked_at')
      .eq('account_id', user.id)
      .eq('consent_key', CONSENT_SHARE_CHECKINS)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setShareConsent(!!data.granted_at && !data.revoked_at);
      });
  }, [user?.id]);

  const checkedCount = checked.filter(Boolean).length;
  const showSelfCheckResult = checkedCount >= SELF_CHECK_THRESHOLD;
  const maxVal = Math.max(1, ...points.map((p) => Math.max(p.warnings, p.recoveries)));

  const trendLabel =
    trend === 'worsening'
      ? t('trajectory.trendWorsening')
      : trend === 'improving'
      ? t('trajectory.trendImproving')
      : trend === 'steady'
      ? t('trajectory.trendSteady')
      : t('trajectory.trendNone');

  function toggleItem(i: number) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  async function shareWithCoach() {
    setShared(true);
    await send(t('trajectory.shareMessage'));
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>
          {t('trajectory.title')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
          {t('trajectory.subtitle')}
        </Text>

        {/* Trend chart */}
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : (
            <>
              <Text style={[styles.trendLabel, { color: colors.ink }]}>{trendLabel}</Text>
              <View style={styles.chartRow}>
                {points.map((p) => (
                  <WeekColumn
                    key={p.week}
                    point={p}
                    maxVal={maxVal}
                    coral={colors.coral}
                    green={colors.green}
                    line={colors.line}
                    inkSoft={colors.inkSoft}
                  />
                ))}
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.coral }]} />
                  <Text style={[styles.legendText, { color: colors.inkSoft }]}>
                    {t('trajectory.legendWarning')}
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.green }]} />
                  <Text style={[styles.legendText, { color: colors.inkSoft }]}>
                    {t('trajectory.legendRecovery')}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Self-check */}
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>
            {t('trajectory.selfCheckTitle')}
          </Text>
          <Text style={[styles.cardSub, { color: colors.inkSoft }]}>
            {t('trajectory.selfCheckSub')}
          </Text>

          {items.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={styles.checkRow}
              onPress={() => toggleItem(i)}
              activeOpacity={0.75}
            >
              <View
                style={[
                  styles.checkBox,
                  {
                    borderColor: checked[i] ? colors.primary : colors.line,
                    backgroundColor: checked[i] ? colors.primary : 'transparent',
                  },
                ]}
              >
                {checked[i] && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={[styles.checkLabel, { color: colors.ink }]}>{item}</Text>
            </TouchableOpacity>
          ))}

          {showSelfCheckResult && (
            <View style={[styles.resultBox, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
              <Text style={[styles.resultText, { color: colors.ink }]}>
                {t('trajectory.selfCheckResult')}
              </Text>
              <TouchableOpacity
                style={[styles.resultBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push('/plan-intervention')}
                activeOpacity={0.85}
              >
                <Text style={styles.resultBtnText}>{t('trajectory.selfCheckCta')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Consent-gated coach share */}
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>
            {t('trajectory.shareTitle')}
          </Text>
          <Text style={[styles.cardSub, { color: colors.inkSoft }]}>
            {t('trajectory.shareBody')}
          </Text>
          {!shareConsent ? (
            <TouchableOpacity onPress={() => router.push('/settings')} activeOpacity={0.8}>
              <Text style={[styles.lockedNote, { color: colors.inkSoft }]}>
                🔒 {t('trajectory.shareLocked')}
              </Text>
            </TouchableOpacity>
          ) : shared ? (
            <Text style={[styles.sharedNote, { color: colors.green }]}>
              ✓ {t('trajectory.shareDone')}
            </Text>
          ) : (
            <TouchableOpacity
              style={[styles.shareBtn, { borderColor: colors.primary }]}
              onPress={() => void shareWithCoach()}
              activeOpacity={0.85}
            >
              <Text style={[styles.shareBtnText, { color: colors.primary }]}>
                {t('trajectory.shareButton')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function WeekColumn({
  point,
  maxVal,
  coral,
  green,
  line,
  inkSoft,
}: {
  point: WeekPoint;
  maxVal: number;
  coral: string;
  green: string;
  line: string;
  inkSoft: string;
}) {
  const wH = Math.max(point.warnings ? 3 : 0, (point.warnings / maxVal) * BAR_MAX_H);
  const rH = Math.max(point.recoveries ? 3 : 0, (point.recoveries / maxVal) * BAR_MAX_H);
  return (
    <View style={styles.weekCol}>
      <View style={[styles.barsTrack, { height: BAR_MAX_H }]}>
        <View style={[styles.bar, { height: wH, backgroundColor: coral }]} />
        <View style={[styles.bar, { height: rH, backgroundColor: green }]} />
      </View>
      <View style={[styles.weekBaseline, { backgroundColor: line }]} />
      <Text style={[styles.weekLabel, { color: inkSoft }]}>{weekLabel(point.week)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  back: { fontSize: 30, fontWeight: '600', marginTop: -4 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  body: {
    padding: 20,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    paddingBottom: 48,
  },
  subtitle: { fontSize: 14, lineHeight: 21, marginBottom: 8 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    marginTop: 14,
  },
  trendLabel: { fontSize: 15.5, fontWeight: '700', marginBottom: 14 },
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  weekCol: { flex: 1, alignItems: 'center' },
  barsTrack: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
  },
  bar: { width: 9, borderRadius: 3 },
  weekBaseline: { height: 1, alignSelf: 'stretch', marginTop: 4, marginHorizontal: 4 },
  weekLabel: { fontSize: 10.5, marginTop: 4 },
  legendRow: { flexDirection: 'row', gap: 18, marginTop: 14, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12 },
  cardTitle: { fontSize: 15.5, fontWeight: '700' },
  cardSub: { fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 8 },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { flex: 1, fontSize: 14, lineHeight: 20 },
  resultBox: { borderRadius: 14, borderWidth: 1.5, padding: 14, marginTop: 12, gap: 10 },
  resultText: { fontSize: 13.5, lineHeight: 20 },
  resultBtn: { borderRadius: 99, paddingVertical: 12, alignItems: 'center' },
  resultBtnText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  lockedNote: { fontSize: 13, lineHeight: 19 },
  sharedNote: { fontSize: 14, fontWeight: '600' },
  shareBtn: {
    borderRadius: 99,
    borderWidth: 1.5,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareBtnText: { fontSize: 14.5, fontWeight: '700' },
});
