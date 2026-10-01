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
  expiration?: number;
  // Internal deadline, stripped before the provider request.
  expiresAt?: string;
  data?: Record<string, unknown>;
};

type PushResult = { ok: true } | { ok: false; error: string };
type OutboxRow = { id: string; account_id: string; kind: string; title: string; body: string; metadata: Record<string, unknown> | null; expires_at?: string | null; attempt_count: number; processing_token: string };

type ExpoTicket = {
  id?: string;
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
type DeliveryGuard = (index: number) => Promise<({ ok: true; ttl?: number; to?: string; expiresAt?: string }) | { ok: false; error: string }>;

function deliveryDecision(data: unknown): Awaited<ReturnType<DeliveryGuard>> {
  if (data === null) return { ok: false, error: "push_ineligible" };
  if (!data || typeof data !== "object") return { ok: false, error: "eligibility_lookup_failed" };
  const value = data as Record<string, unknown>;
  if (typeof value.push_token !== "string" || !value.push_token ||
      (value.ttl != null && (typeof value.ttl !== "number" || !Number.isFinite(value.ttl))) ||
      (value.expires_at != null && (typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at))))) {
    return { ok: false, error: "eligibility_lookup_failed" };
  }
  return { ok: true, to: value.push_token,
    ...(typeof value.ttl === "number" ? { ttl: value.ttl } : {}),
    ...(typeof value.expires_at === "string" ? { expiresAt: value.expires_at } : {}) };
}

async function sendExpoPushResults(
  messages: PushMessage[],
  clearDeadTokens?: DeadTokenSink,
  revalidate?: DeliveryGuard,
): Promise<PushResult[]> {
  const results: PushResult[] = [];
  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const originalChunk = messages.slice(i, i + CHUNK);
    // Refresh claim-bound eligibility for this chunk, not the entire backlog.
    // No database writes or other awaited work intervene before the provider call.
    // Withdrawal after this check / during fetch cannot recall an in-flight request.
    const eligibility = revalidate
      ? await Promise.all(originalChunk.map((_, index) => revalidate(i + index)))
      : originalChunk.map(() => ({ ok: true as const }));
    const skipped = new Map<number, PushResult>();
    const chunk = originalChunk.flatMap((message, index) => {
      const guard = eligibility[index];
      if (!guard.ok) {
        skipped.set(index, guard);
        return [];
      }
      const { expiresAt: originalExpiry, ...payload } = message;
      if ("to" in guard && guard.to) payload.to = guard.to;
      const expiresAt = "expiresAt" in guard && guard.expiresAt
        ? (originalExpiry && Date.parse(originalExpiry) < Date.parse(guard.expiresAt) ? originalExpiry : guard.expiresAt)
        : originalExpiry;
      if ("ttl" in guard && typeof guard.ttl === "number") {
        payload.ttl = Math.min(payload.ttl ?? guard.ttl, guard.ttl);
      }
      if (expiresAt) {
        const remaining = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
        if (!Number.isFinite(remaining) || remaining < 1) {
          skipped.set(index, { ok: false, error: "push_expired" });
          return [];
        }
        payload.ttl = Math.min(payload.ttl ?? remaining, remaining);
      }
      if (payload.ttl !== undefined) {
        if (!Number.isFinite(payload.ttl) || payload.ttl < 1) {
          skipped.set(index, { ok: false, error: "push_expired" });
          return [];
        }
        // Expo gives ttl precedence over expiration. Send only an absolute
        // deadline so transport/provider delay cannot restart the lifetime.
        payload.expiration = Math.floor(Date.now() / 1000 + payload.ttl);
        delete payload.ttl;
      }
      return [payload];
    });
    const appendResults = (activeResults: PushResult[]) => {
      let next = 0;
      results.push(...originalChunk.map((_, index): PushResult =>
        skipped.get(index) ?? activeResults[next++]));
    };
    if (!chunk.length) {
      appendResults([]);
      continue;
    }
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
      appendResults(
        chunk.map(() => ({
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
      appendResults(
        chunk.map(() => ({
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
      appendResults(
        chunk.map(() => ({
          ok: false as const,
          error: "expo_invalid_response",
        })),
      );
      continue;
    }

    const chunkResults: PushResult[] = [];
    for (const [index, ticket] of tickets.entries()) {
      if (ticket?.status === "ok" && typeof ticket.id === "string" && ticket.id.trim()) {
        chunkResults.push({ ok: true });
      } else {
        if (ticket?.details?.error === "DeviceNotRegistered") deadTokens.push(chunk[index].to);
        const errorCode = safePushError(
          ticket?.details?.error,
          "expo_ticket_error",
        );
        const message = safePushError(ticket?.message, "");
        chunkResults.push({
          ok: false,
          error: message ? `${errorCode}: ${message}`.slice(0, 300) : errorCode,
        });
      }
    }
    appendResults(chunkResults);
  }
  // The app was uninstalled or the token rotated: stop pushing to it.
  if (deadTokens.length && clearDeadTokens) await clearDeadTokens(deadTokens);
  return results;
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
    try {
      const { error } = await supabase.from("accounts").update({ push_token: null }).in("push_token", tokens);
      if (error) console.error("[push] clearing dead tokens failed", { count: tokens.length });
    } catch { console.error("[push] clearing dead tokens failed", { count: tokens.length }); }
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
    const canceledInvitationIds: string[] = [];
    const eligibilityRetryRows: OutboxRow[] = [];
    const sendable: { row: typeof rows[number]; message: PushMessage }[] = [];

    // Every outbox row remains distinct. In particular, separate session
    // notifications must not be collapsed merely because account and kind match.
    for (const row of rows) {
      const token = tokenByAccount.get(row.account_id);
      if (!token) {
        tokenlessIds.push(row.id);
        continue;
      }
      // Legacy practice rows also retain their original deadline in metadata;
      // the delivery RPC caps it by the immutable outbox deadline.
      const expiresAt = row.kind === "practice_incoming"
        ? (typeof row.metadata?.expires_at === "string" ? row.metadata.expires_at : undefined)
        : row.expires_at;
      let deliveryPolicy = pushDeliveryPolicy(row.kind, expiresAt);
      if (row.kind === "practice_incoming" || row.kind === "invitation_window") {
        const invitation = row.kind === "invitation_window";
        const canceledIds = invitation ? canceledInvitationIds : canceledPracticeIds;
        const eventId = row.metadata?.event_id;
        if (invitation ? !deliveryPolicy.ttl : typeof eventId !== "string" ||
          !expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
          canceledIds.push(row.id);
          continue;
        }
        try {
          const { data: remainingTtl, error: eligibilityError } = invitation
            ? await supabase.rpc("invitation_push_delivery_ttl", {
              p_outbox_id: row.id, p_processing_token: row.processing_token,
            })
            : await supabase.rpc("practice_push_delivery_ttl", {
              p_event_id: eventId, p_account_id: row.account_id,
            });
          if (eligibilityError) throw new Error("eligibility_lookup_failed");
          if (remainingTtl === null || (typeof remainingTtl === "number" && Number.isFinite(remainingTtl) && remainingTtl < 1)) {
            canceledIds.push(row.id);
            continue;
          }
          if (typeof remainingTtl !== "number" || !Number.isFinite(remainingTtl)) {
            throw new Error("invalid_eligibility_response");
          }
          deliveryPolicy = { ttl: invitation
            ? Math.min(remainingTtl, pushDeliveryPolicy(row.kind, row.expires_at).ttl ?? 0)
            : remainingTtl };
          if (deliveryPolicy.ttl! < 1) {
            canceledIds.push(row.id);
            continue;
          }
        } catch {
          // A failed read is not evidence of withdrawal/expiry. Bound retries
          // and release the lease, retaining the original absolute expiry.
          eligibilityRetryRows.push(row);
          continue;
        }
      }
      sendable.push({
        row,
        message: {
          to: token,
          title: row.title,
          body: row.body,
          sound: "default",
          ...deliveryPolicy,
          ...(expiresAt ? { expiresAt } : {}),
          data: row.metadata && typeof row.metadata === "object"
            ? row.metadata
            : {},
        },
      });
    }

    for (const row of eligibilityRetryRows) {
      const attemptCount = (row.attempt_count ?? 0) + 1;
      const { error: retryError } = await supabase.from("push_outbox").update({
        attempt_count: attemptCount,
        last_error: "eligibility_lookup_failed",
        failed_at: attemptCount >= MAX_ATTEMPTS ? now : null,
        scheduled_for: new Date(Date.now() + Math.min(3600, 60 * 2 ** (attemptCount - 1)) * 1000).toISOString(),
        processing_at: null,
        processing_token: null,
      }).eq("id", row.id).eq("processing_token", row.processing_token)
        .is("sent_at", null).is("failed_at", null);
      if (retryError) return json({ error: retryError.message }, 500);
    }

    if (canceledInvitationIds.length) {
      const { error: canceledError } = await supabase.from("push_outbox")
        .update({ failed_at: now, last_error: "invitation_expired_or_ineligible", processing_at: null, processing_token: null })
        .in("id", canceledInvitationIds).eq("processing_token", claimToken);
      if (canceledError) return json({ error: canceledError.message }, 500);
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
      async (index) => {
        const row = sendable[index].row;
        if (row.kind === "practice_incoming" || row.kind === "invitation_window") {
        const invitation = row.kind === "invitation_window";
        try {
          const { data: ttl, error } = invitation
            ? await supabase.rpc("invitation_push_delivery_ttl", {
              p_outbox_id: row.id, p_processing_token: row.processing_token,
            })
            : await supabase.rpc("practice_push_delivery_ttl", {
              p_event_id: row.metadata?.event_id, p_account_id: row.account_id,
            });
          if (error) throw new Error("eligibility_lookup_failed");
          if (ttl === null || (typeof ttl === "number" && Number.isFinite(ttl) && ttl < 1)) {
            return { ok: false, error: invitation ? "invitation_expired_or_ineligible" : "practice_expired_or_ineligible" };
          }
          if (typeof ttl !== "number" || !Number.isFinite(ttl)) {
            throw new Error("invalid_eligibility_response");
          }
          sendable[index].message.ttl = Math.min(sendable[index].message.ttl ?? ttl, ttl);
        } catch {
          return { ok: false, error: "eligibility_lookup_failed" };
        }
        }
        // Final authority is claim-bound and returns the current destination.
        try {
          const { data, error } = await supabase.rpc("dispatcher_outbox_delivery", {
            p_outbox_id: row.id, p_processing_token: row.processing_token,
          });
          return error ? { ok: false, error: "eligibility_lookup_failed" } : deliveryDecision(data);
        } catch {
          return { ok: false, error: "eligibility_lookup_failed" };
        }
      },
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
            failed_at: result.error === "push_ineligible" || result.error === "push_expired" || result.error === "invitation_expired_or_ineligible" || result.error === "practice_expired_or_ineligible" || attemptCount >= MAX_ATTEMPTS ? now : null,
            ...(result.error === "eligibility_lookup_failed" ? {
              scheduled_for: new Date(Date.now() + Math.min(3600, 60 * 2 ** (attemptCount - 1)) * 1000).toISOString(),
            } : {}),
            processing_at: null,
            processing_token: null,
          })
          .eq("id", row.id)
          .eq("processing_token", row.processing_token)
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

  if (["session_reminder", "family_call_30min", "winback"].includes(job)) {
    if (job !== "winback" && !force && !isFamilySquaresReminderHour(new Date())) {
      return json({ success: true, job, sent: 0, skipped: "outside_reminder_hour" });
    }
    // Database selection supplies stable account + occurrence identities; force
    // previews the next real occurrence, never bypassing consent or source checks.
    const asOf = new Date().toISOString();
    let afterAccountId: string | null = null;
    let sent = 0;
    let retryable = 0;
    // Drain a stable UUID keyset, including past accepted/leased recipients.
    // OFFSET skips winback rows as acknowledgments remove them from eligibility.
    // Continue until empty, even when PostgREST caps below our SQL page size.
    while (true) {
      let data;
      try {
        const page = await supabase.rpc("dispatcher_job_targets", {
          p_job: job, p_force: force === true,
          p_after_account_id: afterAccountId, p_as_of: asOf,
        });
        if (page.error) throw page.error;
        data = page.data;
      } catch {
        return json({ success: false, job, sent, retryable: retryable + 1, error: "candidate_lookup_failed" }, 503);
      }
      if (!Array.isArray(data)) {
        return json({ success: false, job, sent, retryable: retryable + 1, error: "invalid_candidate_page" }, 503);
      }
      const targets = data as { account_id: string; first_name: string | null;
        push_token: string; locale: string | null; session_id: string | null; expires_at: string }[];
      if (!targets.length) break;
      // Fail closed instead of spinning/repeating if the SQL cursor contract drifts.
      let previous: string | null = afterAccountId;
      for (const target of targets) {
        if (typeof target.account_id !== "string" || (previous !== null && target.account_id <= previous)) {
          return json({ success: false, job, sent, retryable: retryable + 1, error: "invalid_candidate_order" }, 503);
        }
        previous = target.account_id;
      }
      afterAccountId = previous;
      const leases = new Map<number, { processing_token: string; reservation_kind: string; event_key: string }>();
      const results = await sendExpoPushResults(targets.map((target): PushMessage => {
        const es = (target.locale ?? "en").startsWith("es");
        const winback = job === "winback";
        const halfHour = job === "family_call_30min";
        return {
          to: target.push_token,
          title: winback ? "Sober Helpline" : halfHour
            ? (es ? "The Family Squares comienza en 30 minutos" : "The Family Squares starts in 30 minutes")
            : "The Family Squares",
          body: winback
            ? (es ? "Seguimos aquí. 90 segundos para ti cuando quieras — sin tener que ponerte al día."
              : "We're still here. 90 seconds for yourself whenever you're ready — no catching up required.")
            : halfHour
            ? (es ? "Llamada gratuita de apoyo familiar por Zoom a las 7:00 PM (Pacífico). Ven tal como estás — toca para unirte."
              : "Free family support call on Zoom at 7:00 PM Pacific. Come as you are — tap to join.")
            : (es ? "Tu grupo comienza en aproximadamente una hora. Tu lugar está guardado — ven tal como estás."
              : "Your group starts in about an hour. Your seat is saved — come as you are."),
          sound: "default", expiresAt: force === true && !winback
            ? new Date(Math.min(Date.parse(target.expires_at), Date.now() + (halfHour ? 1800 : 3600) * 1000)).toISOString()
            : target.expires_at,
          data: winback ? winbackData() : sessionReminderData(target.session_id),
        };
      }), clearDeadTokens, async (index) => {
        const target = targets[index];
        try {
          const { data, error } = await supabase.rpc("claim_dispatcher_job", {
            p_job: job, p_account_id: target.account_id,
            p_session_id: target.session_id, p_expires_at: target.expires_at, p_force: force === true,
          });
          if (error) return { ok: false, error: "eligibility_lookup_failed" };
          if (data !== null) {
            if (!data || typeof data.processing_token !== "string" ||
                typeof data.reservation_kind !== "string" || typeof data.event_key !== "string") {
              return { ok: false, error: "eligibility_lookup_failed" };
            }
            leases.set(index, data);
          }
          return deliveryDecision(data);
        } catch { return { ok: false, error: "eligibility_lookup_failed" }; }
      });
      const delivered = targets.filter((_, index) => results[index]?.ok);
      let ackFailures = 0;
      for (const [index, lease] of leases) {
        try {
          const { data, error } = await supabase.rpc("finish_push_recipient", {
            p_kind: lease.reservation_kind, p_event_key: lease.event_key,
            p_account_id: targets[index].account_id, p_processing_token: lease.processing_token,
            p_accepted: results[index]?.ok === true,
          });
          if (error || data !== true) ackFailures++;
        } catch { ackFailures++; }
      }
      sent += delivered.length;
      retryable += ackFailures + results.filter((result) => !result.ok && result.error !== "push_ineligible" && result.error !== "push_expired").length;
    }
    return json({ success: retryable === 0, job, sent, retryable }, retryable ? 503 : 200);
  }

  return json({ error: `unknown job: ${job}` }, 400);
});
