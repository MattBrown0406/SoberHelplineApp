import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Mirrors App Store (RevenueCat) subscriptions into the entitlements table so
// database RLS gates (Urgent Text Line, private video) recognize paying IAP
// subscribers — the client-side RevenueCat check can't be seen by Postgres.
//
// Flow: app invokes this with the signed-in user's JWT; we resolve their
// account id (which is also their RevenueCat app_user_id, per
// configureRevenueCat), ask the RevenueCat REST API for their active
// entitlements SERVER-SIDE (client claims are never trusted), and reconcile
// source='revenuecat' rows. Expiry comes from RevenueCat's expires_date, so a
// lapsed subscription stops passing the gates automatically.
//
// Secret required: REVENUECAT_SECRET_API_KEY (sk_…) from the RevenueCat
// dashboard → API keys.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

import { fetchRevenueCatMirror } from "../_shared/revenuecat-reconcile.ts";
import { sandboxAllowed } from "../_shared/revenuecat-validation.ts";

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
  const rcKey = Deno.env.get("REVENUECAT_SECRET_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Supabase env missing" }, 500);
  }
  if (!rcKey) {
    return json({ error: "REVENUECAT_SECRET_API_KEY not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userError || !userData?.user) return json({ error: "unauthorized" }, 401);

  const { data: account } = await admin
    .from("accounts")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!account) return json({ error: "no account" }, 404);

  // Server-side lookup — the account id is the RevenueCat app_user_id.
  let mirrored: Record<string, string> = {};
  try {
    mirrored = await fetchRevenueCatMirror(
      account.id,
      rcKey,
      sandboxAllowed(
        account.id,
        userData.user.email,
        Boolean(userData.user.email_confirmed_at),
        Deno.env.get("REVENUECAT_SANDBOX_ACCOUNT_IDS") ?? "",
      ),
    );
  } catch (err) {
    return json({
      error: `revenuecat unreachable: ${String(err).slice(0, 200)}`,
    }, 502);
  }

  // Reconcile in one database transaction. If validation or insertion fails,
  // Postgres rolls the entire change back and preserves the prior access rows.

  const { data: granted, error: reconcileError } = await admin.rpc(
    "reconcile_revenuecat_entitlements",
    { p_account_id: account.id, p_entitlements: mirrored },
  );
  if (reconcileError) return json({ error: reconcileError.message }, 500);

  return json({ success: true, tiers: granted ?? [] });
});
