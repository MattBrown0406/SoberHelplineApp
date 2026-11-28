import { createClient } from "npm:@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/service-auth.ts";
import { sessionReminderData, morningNoteData } from "../_shared/push-data.ts";
// Generic lock-screen copy; actual topics and local meeting times live inside the app.
const copy = {
  preview: {
    title: "Your next meeting",
    body: "See what is planned and save your seat in the app.",
  },
  morning: {
    title: "Your seat is saved",
    body: "Open the app for your meeting time and details.",
  },
  join: {
    title: "Starting in 15 minutes",
    body: "Your meeting is about to begin. Tap to join.",
  },
};
Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const candidates = await db.rpc("service_monday_reminder_candidates");
  if (candidates.error || !Array.isArray(candidates.data))
    return new Response("candidate lookup failed", { status: 503 });
  let sent = 0,
    failed = 0;
  for (const candidate of candidates.data) {
    const args = {
      p_account: candidate.account_id,
      p_date: candidate.meeting_date,
      p_phase: candidate.phase,
    };
    const claimed = await db.rpc("service_claim_monday_reminder", args);
    if (claimed.error || !claimed.data) continue;
    let outcome = "failed";
    try {
      const current = await db.rpc("service_monday_reminder_delivery", args);
      if (current.error) throw new Error("eligibility unavailable");
      if (!current.data) {
        outcome = "skipped";
        continue;
      }
      const delivery = current.data;
      const phase = delivery.phase as keyof typeof copy;
      const expires = Math.floor(Date.parse(delivery.expires_at) / 1000);
      if (
        !copy[phase] ||
        !Number.isFinite(expires) ||
        expires <= Date.now() / 1000
      ) {
        outcome = "skipped";
        continue;
      }
      // Each occurrence/phase is claimed once. An ambiguous transport failure is
      // not automatically retried: avoiding duplicate sensitive reminders wins.
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: delivery.push_token,
          sound: "default",
          ...copy[phase],
          expiration: expires,
          data:
            phase === "join"
              ? sessionReminderData(delivery.session_id)
              : morningNoteData("today"),
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("provider unavailable");
      const ticket = await response.json();
      if (ticket.data?.status !== "ok") throw new Error("provider rejected");
      outcome = "sent";
      sent++;
    } catch {
      failed++;
    } finally {
      await db.rpc("service_finish_monday_reminder", {
        ...args,
        p_outcome: outcome,
      });
    }
  }
  return Response.json({ sent, failed });
});
