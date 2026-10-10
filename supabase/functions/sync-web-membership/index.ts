import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { parseWebMembership } from "../_shared/membership-validation.ts";

// Bridges soberhelpline.com memberships into app entitlements.
//
// Flow: the app invokes this with the signed-in user's JWT. We derive the
// email from the verified token (never from the request body — no spoofing),
// ask the website's check-membership-email function (server-to-server, shared
// secret) whether that email has an active family membership, and maintain a
// source='web' Essential entitlement row accordingly.
//
// The entitlement carries a rolling 35-day expiry refreshed when fewer than 34 days remain,
// so a lapsed website membership stops unlocking the app within ~a month even
// if the user never opens it again (and immediately on next app open).
//
// Secrets required (app project): MEMBERSHIP_SYNC_SECRET — must match the
// website project's secret of the same name.
//
// AyudaSobria.com (the Spanish site) is a second source: when AYUDA_SYNC_SECRET is
// set, its /api/membership/check is asked the same question, and a member of either
// site gets Essential. A site that can't be reached never causes a revoke.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WEBSITE_CHECK_URL =
  "https://anwqprmpzmcqbkttmxos.supabase.co/functions/v1/check-membership-email";
const AYUDA_CHECK_URL = "https://ayudasobria.com/api/membership/check";

type SiteCheck = { ok: true; isMember: boolean } | { ok: false; error: string };

/** Asks one website whether this email holds an active membership there. */
async function checkSite(
  url: string,
  secret: string,
  email: string,
  notDeployedMeansNo = false,
): Promise<SiteCheck> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-membership-sync-secret": secret,
      },
      body: JSON.stringify({ email }),
    });
    // Until AyudaSobria publishes its check endpoint it answers 404: nobody is a member there yet.
    if (notDeployedMeansNo && resp.status === 404) {
      await resp.body?.cancel();
      return { ok: true, isMember: false };
    }
    if (!resp.ok) {
      await resp.body?.cancel();
      return { ok: false, error: `check failed: ${resp.status}` };
    }
    return { ok: true, isMember: parseWebMembership(await resp.json()) };
  } catch (err) {
    return { ok: false, error: `unreachable: ${String(err).slice(0, 200)}` };
  }
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
  const syncSecret = Deno.env.get("MEMBERSHIP_SYNC_SECRET");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Supabase env missing" }, 500);
  }
  if (!syncSecret) {
    return json({ error: "MEMBERSHIP_SYNC_SECRET not configured" }, 500);
  }

  // Verify the caller is a signed-in app user; email comes from the token.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userError || !userData?.user?.email) {
    return json({ error: "unauthorized" }, 401);
  }
  // Only a verified address may claim a website membership bought with that email.
  if (!userData.user.email_confirmed_at) return json({ error: "email_unverified" }, 403);
  const email = userData.user.email.toLowerCase().trim();

  const { data: account } = await admin
    .from("accounts")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!account) return json({ error: "no account" }, 404);

  // Ask soberhelpline.com (and AyudaSobria.com, when configured) whether this
  // email holds an active family membership.
  const ayudaSecret = Deno.env.get("AYUDA_SYNC_SECRET") ?? "";
  const checks = await Promise.all([
    checkSite(WEBSITE_CHECK_URL, syncSecret, email),
    ayudaSecret ? checkSite(AYUDA_CHECK_URL, ayudaSecret, email, true) : null,
  ]);
  const answered = checks.filter((c): c is SiteCheck => c !== null);
  const isMember = answered.some((c) => c.ok && c.isMember);
  const failure = answered.find((c): c is { ok: false; error: string } => !c.ok);
  if (!isMember && failure) {
    // Don't revoke on transient website errors — just report and bail.
    return json({ error: `website ${failure.error}` }, 502);
  }

  // Validation happens before this atomic, service-only database transaction.
  const { error: reconcileError } = await admin.rpc(
    "reconcile_web_membership",
    {
      p_account_id: account.id,
      p_membership: { isMember, email },
    },
  );
  if (reconcileError) {
    console.error("sync-web-membership: reconcile failed", reconcileError.code ?? "unknown");
    return json({ error: "reconcile_failed" }, 500);
  }

  return json({
    success: true,
    member: isMember,
    tier: isMember ? "essential" : null,
  });
});
