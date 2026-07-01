import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hubUrl = Deno.env.get("HUB_INGEST_URL");
  const hubKey = Deno.env.get("HUB_INGEST_KEY");

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Supabase env missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!hubUrl || !hubKey) {
    return new Response(JSON.stringify({ error: "HUB_INGEST_URL / HUB_INGEST_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Fetch pending or retryable-failed rows
  const { data: rows, error: fetchError } = await supabase
    .from("spine_outbox")
    .select("id, event_name, payload, status, attempts")
    .or(`status.eq.pending,and(status.eq.failed,attempts.lt.${MAX_ATTEMPTS})`)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = { processed: 0, sent: 0, failed: 0 };

  for (const row of rows ?? []) {
    results.processed++;
    try {
      const resp = await fetch(hubUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${hubKey}`,
        },
        body: JSON.stringify({
          event: row.event_name,
          ...row.payload,
        }),
      });

      if (resp.ok) {
        await supabase
          .from("spine_outbox")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts: (row.attempts ?? 0) + 1,
            last_error: null,
          })
          .eq("id", row.id);
        results.sent++;
      } else {
        const text = await resp.text().catch(() => "");
        await supabase
          .from("spine_outbox")
          .update({
            status: "failed",
            attempts: (row.attempts ?? 0) + 1,
            last_error: `HTTP ${resp.status}: ${text.slice(0, 500)}`,
          })
          .eq("id", row.id);
        results.failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("spine_outbox")
        .update({
          status: "failed",
          attempts: (row.attempts ?? 0) + 1,
          last_error: message.slice(0, 500),
        })
        .eq("id", row.id);
      results.failed++;
    }
  }

  return new Response(JSON.stringify({ success: true, ...results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
