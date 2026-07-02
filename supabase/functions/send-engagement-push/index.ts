import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Engagement push dispatcher. pg_cron invokes it with { job }:
//   drain            — send queued push_outbox rows (community hearts, etc.)
//   session_reminder — "Monday group starts soon" to everyone RSVP'd going
//   winback          — gentle nudge to members silent for 5+ days
// All sends go through Expo's push API using tokens stored on accounts.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const SESSION_TITLE = "Monday Night Family Support";
const CHUNK = 100; // Expo push API max messages per request

type PushMessage = { to: string; title: string; body: string; sound: "default" };

async function sendExpoPush(messages: PushMessage[]): Promise<number> {
  let sent = 0;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (resp.ok) sent += chunk.length;
    else console.error("[push] Expo error", resp.status, await resp.text().catch(() => ""));
  }
  return sent;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase env missing" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);
  const { job } = await req.json().catch(() => ({ job: "drain" }));

  // ── drain: queued outbox rows, deduped to one push per account+kind ────────
  if (job === "drain" || !job) {
    const { data: rows, error } = await supabase
      .from("push_outbox")
      .select("id, account_id, kind, title, body")
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return json({ error: error.message }, 500);
    if (!rows?.length) return json({ success: true, job, sent: 0 });

    const accountIds = [...new Set(rows.map((r) => r.account_id))];
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, push_token")
      .in("id", accountIds)
      .not("push_token", "is", null);
    const tokenByAccount = new Map((accounts ?? []).map((a) => [a.id, a.push_token as string]));

    // One push per account+kind per drain; a post with five hearts should read
    // as one warm moment, not five buzzes.
    const seen = new Set<string>();
    const messages: PushMessage[] = [];
    for (const row of rows) {
      const token = tokenByAccount.get(row.account_id);
      const dedupeKey = `${row.account_id}:${row.kind}`;
      if (token && !seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        messages.push({ to: token, title: row.title, body: row.body, sound: "default" });
      }
    }
    const sent = await sendExpoPush(messages);

    // Mark the whole batch handled (including token-less rows — they can never send).
    await supabase
      .from("push_outbox")
      .update({ sent_at: new Date().toISOString() })
      .in("id", rows.map((r) => r.id));

    return json({ success: true, job, queued: rows.length, sent });
  }

  // ── session_reminder: RSVP'd members, 1h before the Monday group ───────────
  if (job === "session_reminder") {
    const { data, error } = await supabase.rpc("get_session_rsvp_push_tokens", {
      p_session_title: SESSION_TITLE,
    });
    if (error) return json({ error: error.message }, 500);
    const tokens = [...new Set((data ?? []).map((r: { push_token: string }) => r.push_token))];
    const sent = await sendExpoPush(
      tokens.map((to) => ({
        to,
        title: "Monday Night Family Support",
        body: "Your group starts in about an hour. Your seat is saved — come as you are.",
        sound: "default" as const,
      })),
    );
    return json({ success: true, job, sent });
  }

  // ── winback: members silent 5+ days, max once per 7 days ───────────────────
  if (job === "winback") {
    const { data, error } = await supabase.rpc("get_winback_push_targets");
    if (error) return json({ error: error.message }, 500);
    const targets = (data ?? []) as { account_id: string; first_name: string | null; push_token: string }[];
    if (!targets.length) return json({ success: true, job, sent: 0 });

    const sent = await sendExpoPush(
      targets.map((t) => ({
        to: t.push_token,
        title: "Sober Helpline",
        body: t.first_name
          ? `${t.first_name}, we're still here. 90 seconds for yourself whenever you're ready — no catching up required.`
          : "We're still here. 90 seconds for yourself whenever you're ready — no catching up required.",
        sound: "default" as const,
      })),
    );
    await supabase.rpc("mark_winback_sent", {
      p_account_ids: targets.map((t) => t.account_id),
    });
    return json({ success: true, job, sent });
  }

  return json({ error: `unknown job: ${job}` }, 400);
});
