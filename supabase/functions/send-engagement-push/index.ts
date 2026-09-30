import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { pushDeliveryPolicy } from "../_shared/push-policy.ts";
import { sessionReminderData, winbackData } from "../_shared/push-data.ts";
import { isFamilySquaresReminderHour } from "../_shared/family-squares-time.ts";

// Engagement push dispatcher. pg_cron invokes it with { job }:
//   drain            — send queued push_outbox rows (community hearts, etc.)
//   session_reminder — "Monday group starts soon" to everyone RSVP'd going
//   winback          — gentle nudge to members silent for 5+ days
// All sends go through Expo's push API using tokens stored on accounts.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100; // Expo push API max messages per request
const MAX_ATTEMPTS = 5;

type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  ttl?: number;
  data?: Record<string, unknown>;
};

type PushResult = { ok: true } | { ok: false; error: string };
type OutboxRow = { id: string; account_id: string; kind: string; title: string; body: string; metadata: Record<string, unknown> | null; attempt_count: number; processing_token: string };

type ExpoTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

function safePushError(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  // Store only a bounded provider error description, never a token or payload.
  return value.replace(/[\r\n]+/g, " ").slice(0, 300);
}

type DeadTokenSink = (tokens: string[]) => Promise<void>;

async function sendExpoPushResults(
  messages: PushMessage[],
  clearDeadTokens?: DeadTokenSink,
): Promise<PushResult[]> {
  const results: PushResult[] = [];
  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    let resp: Response;
    try {
      resp = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "request failed";
      console.error("[push] Expo request failed", {
        messageCount: chunk.length,
      });
      results.push(
        ...chunk.map(() => ({
          ok: false as const,
          error: safePushError(reason, "expo_request_failed"),
        })),
      );
      continue;
    }

    if (!resp.ok) {
      console.error("[push] Expo HTTP error", {
        status: resp.status,
        messageCount: chunk.length,
      });
      results.push(
        ...chunk.map(() => ({
          ok: false as const,
          error: `expo_http_${resp.status}`,
        })),
      );
      continue;
    }

    let tickets: ExpoTicket[] | undefined;
    try {
      const payload = await resp.json();
      if (Array.isArray(payload?.data)) tickets = payload.data;
    } catch {
      // Handled as a malformed response below.
    }

    if (!tickets || tickets.length !== chunk.length) {
      console.error("[push] Invalid Expo response", {
        messageCount: chunk.length,
      });
      results.push(
        ...chunk.map(() => ({
          ok: false as const,
          error: "expo_invalid_response",
        })),
      );
      continue;
    }

    for (const [index, ticket] of tickets.entries()) {
      if (ticket?.status === "ok") {
        results.push({ ok: true });
      } else {
        if (ticket?.details?.error === "DeviceNotRegistered") deadTokens.push(chunk[index].to);
        const errorCode = safePushError(
          ticket?.details?.error,
          "expo_ticket_error",
        );
        const message = safePushError(ticket?.message, "");
        results.push({
          ok: false,
          error: message ? `${errorCode}: ${message}`.slice(0, 300) : errorCode,
        });
      }
    }
  }
  // The app was uninstalled or the token rotated: stop pushing to it.
  if (deadTokens.length && clearDeadTokens) await clearDeadTokens(deadTokens);
  return results;
}

async function sendExpoPush(messages: PushMessage[], clearDeadTokens?: DeadTokenSink): Promise<number> {
  const results = await sendExpoPushResults(messages, clearDeadTokens);
  return results.filter((result) => result.ok).length;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase env missing" }, 500);
  // Authenticate before reading or parsing attacker-controlled work descriptions.
  const authorization = req.headers.get("Authorization") ?? "";
  if (authorization !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);
  // The app was uninstalled or the token rotated: stop pushing to it.
  const clearDeadTokens: DeadTokenSink = async (tokens) => {
    const { error } = await supabase.from("accounts").update({ push_token: null }).in("push_token", tokens);
    if (error) console.error("[push] clearing dead tokens failed", { count: tokens.length });
  };
  const { job, force } = await req.json().catch(() => ({ job: "drain", force: false }));

  // ── drain: due, unhandled outbox rows ──────────────────────────────────────
  if (job === "drain" || !job) {
    const now = new Date().toISOString();
    const { data: claimed, error } = await supabase.rpc("claim_push_outbox", { p_limit: 200, p_lease: "5 minutes" });
    const rows = (claimed ?? []) as OutboxRow[];
    if (error) return json({ error: error.message }, 500);
    if (!rows?.length) return json({ success: true, job, sent: 0 });
    const claimToken = rows[0].processing_token;

    const accountIds = [...new Set(rows.map((row) => row.account_id))];
    const { data: accounts, error: accountsError } = await supabase
      .from("accounts")
      .select("id, push_token")
      .in("id", accountIds);
    if (accountsError) return json({ error: accountsError.message }, 500);

    const tokenByAccount = new Map(
      (accounts ?? []).map((
        account,
      ) => [account.id, account.push_token as string | null]),
    );
    const tokenlessIds: string[] = [];
    const canceledPracticeIds: string[] = [];
    const sendable: { row: typeof rows[number]; message: PushMessage }[] = [];

    // Every outbox row remains distinct. In particular, separate session
    // notifications must not be collapsed merely because account and kind match.
    for (const row of rows) {
      const token = tokenByAccount.get(row.account_id);
      if (!token) {
        tokenlessIds.push(row.id);
        continue;
      }
      let deliveryPolicy = pushDeliveryPolicy(row.kind);
      if (row.kind === "practice_incoming") {
        const eventId = row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>).event_id
          : null;
        if (typeof eventId !== "string") {
          canceledPracticeIds.push(row.id);
          continue;
        }
        const { data: remainingTtl, error: eligibilityError } = await supabase.rpc(
          "practice_push_delivery_ttl",
          { p_event_id: eventId, p_account_id: row.account_id },
        );
        if (eligibilityError || typeof remainingTtl !== "number" || remainingTtl < 1) {
          canceledPracticeIds.push(row.id);
          continue;
        }
        deliveryPolicy = { ttl: remainingTtl };
      }
      sendable.push({
        row,
        message: {
          to: token,
          title: row.title,
          body: row.body,
          sound: "default",
          ...deliveryPolicy,
          data: row.metadata && typeof row.metadata === "object"
            ? row.metadata
            : {},
        },
      });
    }

    if (canceledPracticeIds.length) {
      const { error: canceledError } = await supabase
        .from("push_outbox")
        .update({ failed_at: now, last_error: "practice_expired_or_ineligible", processing_at: null, processing_token: null })
        .in("id", canceledPracticeIds).eq("processing_token", claimToken);
      if (canceledError) return json({ error: canceledError.message }, 500);
    }

    if (tokenlessIds.length) {
      const { error: tokenlessError } = await supabase
        .from("push_outbox")
        .update({ failed_at: now, last_error: "no_push_token", processing_at: null, processing_token: null })
        .in("id", tokenlessIds).eq("processing_token", claimToken);
      if (tokenlessError) return json({ error: tokenlessError.message }, 500);
    }

    const results = await sendExpoPushResults(
      sendable.map(({ message }) => message),
      clearDeadTokens,
    );
    const successfulIds: string[] = [];
    const failedUpdates: PromiseLike<{ error: { message: string } | null }>[] =
      [];

    results.forEach((result, index) => {
      const row = sendable[index].row;
      if (result.ok) {
        successfulIds.push(row.id);
        return;
      }
      const attemptCount = (row.attempt_count ?? 0) + 1;
      failedUpdates.push(
        supabase
          .from("push_outbox")
          .update({
            attempt_count: attemptCount,
            last_error: result.error,
            failed_at: attemptCount >= MAX_ATTEMPTS ? now : null,
            processing_at: null,
            processing_token: null,
          })
          .eq("id", row.id)
          .eq("processing_token", claimToken)
          .is("sent_at", null)
          .is("failed_at", null),
      );
    });

    if (successfulIds.length) {
      const { error: sentError } = await supabase
        .from("push_outbox")
        .update({ sent_at: now, last_error: null, processing_at: null, processing_token: null })
        .in("id", successfulIds)
        .eq("processing_token", claimToken)
        .is("sent_at", null)
        .is("failed_at", null);
      if (sentError) return json({ error: sentError.message }, 500);
    }

    const updateResults = await Promise.all(failedUpdates);
    const failedUpdate = updateResults.find((result) => result.error)?.error;
    if (failedUpdate) return json({ error: failedUpdate.message }, 500);

    return json({
      success: true,
      job,
      queued: rows.length,
      sent: successfulIds.length,
      failed: results.filter((result) => !result.ok).length,
      tokenless: tokenlessIds.length,
    });
  }

  // ── session_reminder: RSVP'd members, 1h before the Monday group ───────────
  if (job === "session_reminder") {
    // Scheduled at both UTC hours that can be 6 PM Pacific; only one is.
    if (!force && !isFamilySquaresReminderHour(new Date())) {
      return json({ success: true, job, sent: 0, skipped: "outside_reminder_hour" });
    }
    // No title arg: the RPC resolves the Family Squares session itself
    // (tolerant to the title mismatch that silently broke earlier queries).
    const { data, error } = await supabase.rpc("get_session_reminder_targets");
    if (error) return json({ error: error.message }, 500);
    const targets = (data ?? []) as {
      push_token: string;
      locale: string | null;
    }[];
    const { data: sessionId } = await supabase.rpc("family_squares_session_id");
    const seen = new Set<string>();
    const messages: PushMessage[] = [];
    for (const target of targets) {
      if (seen.has(target.push_token)) continue;
      seen.add(target.push_token);
      const es = (target.locale ?? "en").startsWith("es");
      messages.push({
        to: target.push_token,
        title: "The Family Squares",
        body: es
          ? "Tu grupo comienza en aproximadamente una hora. Tu lugar está guardado — ven tal como estás."
          : "Your group starts in about an hour. Your seat is saved — come as you are.",
        sound: "default",
        data: sessionReminderData(sessionId),
      });
    }
    const sent = await sendExpoPush(messages, clearDeadTokens);
    return json({ success: true, job, sent });
  }

  // ── winback: members silent 5+ days, max once per 7 days ───────────────────
  if (job === "winback") {
    const { data, error } = await supabase.rpc("get_winback_push_targets");
    if (error) return json({ error: error.message }, 500);
    const targets = (data ?? []) as {
      account_id: string;
      first_name: string | null;
      push_token: string;
      locale: string | null;
    }[];
    if (!targets.length) return json({ success: true, job, sent: 0 });

    const results = await sendExpoPushResults(
      targets.map((target) => {
        const es = (target.locale ?? "en").startsWith("es");
        const body = es
          ? target.first_name
            ? `${target.first_name}, seguimos aquí. 90 segundos para ti cuando quieras — sin tener que ponerte al día.`
            : "Seguimos aquí. 90 segundos para ti cuando quieras — sin tener que ponerte al día."
          : target.first_name
          ? `${target.first_name}, we're still here. 90 seconds for yourself whenever you're ready — no catching up required.`
          : "We're still here. 90 seconds for yourself whenever you're ready — no catching up required.";
        return {
          to: target.push_token,
          title: "Sober Helpline",
          body,
          sound: "default" as const,
          data: winbackData(),
        };
      }),
      clearDeadTokens,
    );
    // Only a delivered nudge starts the 7-day quiet period; failures retry tomorrow.
    const delivered = targets.filter((_, index) => results[index]?.ok);
    if (delivered.length) {
      await supabase.rpc("mark_winback_sent", {
        p_account_ids: delivered.map((target) => target.account_id),
      });
    }
    return json({ success: true, job, sent: delivered.length });
  }

  return json({ error: `unknown job: ${job}` }, 400);
});
