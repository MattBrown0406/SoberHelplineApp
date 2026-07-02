import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Bridges soberhelpline.com memberships into app entitlements.
//
// Flow: the app invokes this with the signed-in user's JWT. We derive the
// email from the verified token (never from the request body — no spoofing),
// ask the website's check-membership-email function (server-to-server, shared
// secret) whether that email has an active family membership, and maintain a
// source='web' Essential entitlement row accordingly.
//
// The entitlement carries a rolling 35-day expiry refreshed on every check,
// so a lapsed website membership stops unlocking the app within ~a month even
// if the user never opens it again (and immediately on next app open).
//
// Secrets required (app project): MEMBERSHIP_SYNC_SECRET — must match the
// website project's secret of the same name.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WEBSITE_CHECK_URL =
  "https://anwqprmpzmcqbkttmxos.supabase.co/functions/v1/check-membership-email";
const ROLLING_DAYS = 35;

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
  const syncSecret = Deno.env.get("MEMBERSHIP_SYNC_SECRET");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase env missing" }, 500);
  if (!syncSecret) return json({ error: "MEMBERSHIP_SYNC_SECRET not configured" }, 500);

  // Verify the caller is a signed-in app user; email comes from the token.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userError || !userData?.user?.email) return json({ error: "unauthorized" }, 401);
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
    isMember = !!(await resp.json()).isMember;
  } catch (err) {
    return json({ error: `website unreachable: ${String(err).slice(0, 200)}` }, 502);
  }

  // Reconcile the web entitlement. Delete-then-insert keeps the row's
  // created_at fresh so AccountContext (which reads the newest row) sees it.
  await admin
    .from("entitlements")
    .delete()
    .eq("account_id", account.id)
    .eq("source", "web");

  if (isMember) {
    const expires = new Date(Date.now() + ROLLING_DAYS * 86400000).toISOString();
    const { error: insErr } = await admin.from("entitlements").insert({
      account_id: account.id,
      source: "web",
      tier: "essential",
      expires_at: expires,
      raw: { checked_at: new Date().toISOString(), email },
    });
    if (insErr) return json({ error: insErr.message }, 500);
  }

  return json({ success: true, member: isMember, tier: isMember ? "essential" : null });
});
