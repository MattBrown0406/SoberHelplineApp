import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  fetchRevenueCatMirror,
  revenueCatWebhook,
} from "../_shared/revenuecat-reconcile.ts";
import { sandboxAllowed } from "../_shared/revenuecat-validation.ts";

serve((req) =>
  revenueCatWebhook(
    req,
    Deno.env.get("REVENUECAT_WEBHOOK_SECRET"),
    async (id) => {
      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const rcKey = Deno.env.get("REVENUECAT_SECRET_API_KEY");
      if (!url || !serviceKey || !rcKey) {
        throw new Error("missing server configuration");
      }
      const admin = createClient(url, serviceKey);
      const { data: account, error } = await admin.from("accounts").select(
        "id,user_id",
      ).eq("id", id).maybeSingle();
      if (error) throw error;
      if (!account) return;
      const { data, error: userError } = await admin.auth.admin.getUserById(
        account.user_id,
      );
      if (userError || !data.user) {
        throw new Error("account user lookup failed");
      }
      const mirror = await fetchRevenueCatMirror(
        account.id,
        rcKey,
        sandboxAllowed(
          account.id,
          data.user.email,
          Boolean(data.user.email_confirmed_at),
          Deno.env.get("REVENUECAT_SANDBOX_ACCOUNT_IDS") ?? "",
        ),
      );
      const { error: reconcileError } = await admin.rpc(
        "reconcile_revenuecat_entitlements",
        {
          p_account_id: account.id,
          p_entitlements: mirror,
        },
      );
      if (reconcileError) throw reconcileError;
    },
  )
);
