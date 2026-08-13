// notify-situation-brief — Supabase Edge Function
//
// Triggered by a Database Webhook on situation_briefs INSERT.
// Emails Matt the brief so an escalating family never sits unseen, even if
// the admin push lands on a silenced phone.
//
// Setup (mirrors notify-coaching-request):
//   1. RESEND_API_KEY secret must be set (shared with notify-coaching-request)
//   2. supabase functions deploy notify-situation-brief
//   3. Dashboard → Database → Webhooks → Create webhook:
//        Table: situation_briefs  |  Event: INSERT
//        URL: https://<project-ref>.supabase.co/functions/v1/notify-situation-brief
//        HTTP method: POST  |  Add header: Authorization: Bearer <service-role-key>

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const NOTIFY_TO = 'matt@soberhelpline.com';
const NOTIFY_FROM = 'notifications@soberhelpline.com';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

type MoodDay = {
  day?: string;
  mood?: number;
  capacity?: number | null;
  pressure?: number | null;
  support_need?: string | null;
  note?: string | null;
};
type TrackerSign = { sign_key?: string; kind?: string; week?: string };
type Wall = { text?: string; anchor?: string | null };

Deno.serve(async (req: Request) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  try {
    const payload = await req.json();
    const brief = payload.record;
    if (!brief) return new Response('no record', { status: 400 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: account } = await supabase
      .from('accounts')
      .select('first_name, last_name')
      .eq('id', brief.account_id)
      .single();

    const name =
      [account?.first_name, account?.last_name].filter(Boolean).join(' ') || 'A member';

    const sections = (brief.sections ?? {}) as Record<string, unknown>;
    const mood = Array.isArray(sections.mood) ? (sections.mood as MoodDay[]) : [];
    const tracker = Array.isArray(sections.tracker) ? (sections.tracker as TrackerSign[]) : [];
    const walls = Array.isArray(sections.boundaries) ? (sections.boundaries as Wall[]) : [];
    const warnings = tracker.filter((t) => t.kind === 'warning');
    const recoveries = tracker.filter((t) => t.kind === 'recovery');
    const moods = mood.map((m) => m.mood).filter((m): m is number => typeof m === 'number');
    const avgMood = moods.length
      ? (moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1)
      : '—';
    const capacities = mood
      .map((m) => m.capacity)
      .filter((value): value is number => typeof value === 'number');
    const pressures = mood
      .map((m) => m.pressure)
      .filter((value): value is number => typeof value === 'number');
    const avgCapacity = capacities.length
      ? (capacities.reduce((a, b) => a + b, 0) / capacities.length).toFixed(1)
      : null;
    const avgPressure = pressures.length
      ? (pressures.reduce((a, b) => a + b, 0) / pressures.length).toFixed(1)
      : null;
    const latestSupportNeed = mood.find((entry) => entry.support_need)?.support_need ?? null;

    const bandLabel = String(brief.band ?? 'calm').toUpperCase();

    const html = `
      <h2>Situation brief — ${escapeHtml(name)}</h2>
      <p><strong>${escapeHtml(bandLabel)}</strong> · score ${escapeHtml(brief.score)}${
        brief.sustained ? ' · <strong>sustained</strong>' : ''
      }</p>
      ${
        brief.note
          ? `<p><strong>In their own words:</strong><br>${escapeHtml(brief.note).replace(/\n/g, '<br>')}</p>`
          : ''
      }
      <p><strong>Mood (7d):</strong> avg ${escapeHtml(avgMood)} over ${mood.length} check-in${mood.length === 1 ? '' : 's'}</p>
      ${
        avgCapacity && avgPressure
          ? `<p><strong>Caregiver load (7d):</strong> avg capacity ${escapeHtml(avgCapacity)}/5 · avg pressure ${escapeHtml(avgPressure)}/5${
              latestSupportNeed
                ? ` · latest need: ${escapeHtml(latestSupportNeed).replaceAll('_', ' ')}`
                : ''
            }</p>`
          : ''
      }
      <p><strong>Tracker (14d):</strong> ${warnings.length} warning / ${recoveries.length} recovery sign${recoveries.length === 1 ? '' : 's'}${
        warnings.length
          ? '<br>' + warnings.map((w) => `⚠ ${escapeHtml(w.sign_key)}`).join('<br>')
          : ''
      }</p>
      ${
        walls.length
          ? `<p><strong>Boundaries:</strong><br>${walls
              .map((w) => `• ${escapeHtml(w.text)}`)
              .join('<br>')}</p>`
          : ''
      }
      <p><strong>Sent:</strong> ${new Date(brief.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
      <hr>
      <p style="color:#666;font-size:12px;">Open the app → Admin → Situation Briefs to read the full brief and reply in their thread.</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        subject: `Situation brief (${bandLabel}) from ${name}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[notify-situation-brief] Resend error:', err);
      return new Response('email failed', { status: 500 });
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[notify-situation-brief] unexpected error:', err);
    return new Response('error', { status: 500 });
  }
});
