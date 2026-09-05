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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WEBSITE_CHECK_URL =
  "https://anwqprmpzmcqbkttmxos.supabase.co/functions/v1/check-membership-email";

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
  const email = userData.user.email.toLowerCase().trim();

  const { data: account } = await admin
    .from("accounts")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!account) return json({ error: "no account" }, 404);

  // Ask the website whether this email holds an active family membership.
  let isMember = false;
  try {
    const resp = await fetch(WEBSITE_CHECK_URL, {
      signal: AbortSignal.timeout(10_000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-membership-sync-secret": syncSecret,
      },
      body: JSON.stringify({ email }),
    });
    if (!resp.ok) {
      // Don't revoke on transient website errors — just report and bail.
      return json({ error: `website check failed: ${resp.status}` }, 502);
    }
    isMember = parseWebMembership(await resp.json());
  } catch (err) {
    return json(
      { error: `website unreachable: ${String(err).slice(0, 200)}` },
      502,
    );
  }

  // Validation happens before this atomic, service-only database transaction.
  const { error: reconcileError } = await admin.rpc(
    "reconcile_web_membership",
    {
      p_account_id: account.id,
      p_membership: { isMember, email },
    },
  );
  if (reconcileError) return json({ error: reconcileError.message }, 500);

  return json({
    success: true,
    member: isMember,
    tier: isMember ? "essential" : null,
  });
});
