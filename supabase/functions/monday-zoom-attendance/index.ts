import { createClient } from "npm:@supabase/supabase-js@2";
import {
  attendanceReport,
  zoomUuidPath,
  type ZoomParticipant,
} from "../_shared/monday-attendance.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);
  const header = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey || !header.startsWith("Bearer "))
    return reply({ error: "unauthorized" }, 401);
  const payload = await req.json().catch(() => null);
  const date = payload?.meeting_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return reply({ error: "invalid date" }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  // The caller supplies only a date. The UUID comes from an admin-controlled occurrence.
  let uuid: unknown;
  if (header === `Bearer ${serviceKey}`) {
    const result = await admin.rpc("service_monday_occurrence", {
      p_date: date,
    });
    if (result.error) return reply({ error: "lookup failed" }, 503);
    uuid = result.data;
  } else {
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: header } } },
    );
    const result = await caller.rpc("admin_monday_meeting", { p_date: date });
    if (result.error) return reply({ error: "not authorized" }, 403);
    uuid = result.data?.zoom_uuid;
  }
  if (typeof uuid !== "string" || !uuid)
    return reply({ error: "configure occurrence UUID first" }, 409);
  const account = Deno.env.get("ZOOM_ACCOUNT_ID"),
    client = Deno.env.get("ZOOM_CLIENT_ID"),
    secret = Deno.env.get("ZOOM_CLIENT_SECRET");
  if (!account || !client || !secret)
    return reply({ error: "Zoom reporting is not configured" }, 503);
  try {
    const tokenResponse = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${client}:${secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "account_credentials",
        account_id: account,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) throw new Error("authorization failed");
    const token = await tokenResponse.json();
    if (typeof token.access_token !== "string")
      throw new Error("authorization failed");
    const get = async (path: string) => {
      const r = await fetch(`https://api.zoom.us/v2/${path}`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error("report unavailable");
      return r.json();
    };
    const path = zoomUuidPath(uuid);
    const occurrence = await get(`past_meetings/${path}`);
    if (
      occurrence.uuid !== uuid ||
      typeof occurrence.start_time !== "string" ||
      typeof occurrence.end_time !== "string"
    )
      throw new Error("invalid occurrence");
    const rows: ZoomParticipant[] = [];
    const tokens = new Set<string>();
    let next = "";
    let total: number | null = null;
    do {
      const page = await get(
        `past_meetings/${path}/participants?page_size=300${next ? `&next_page_token=${encodeURIComponent(next)}` : ""}`,
      );
      if (
        !Array.isArray(page.participants) ||
        !Number.isInteger(page.total_records) ||
        page.total_records < 0
      )
        throw new Error("invalid report");
      if (total !== null && total !== page.total_records)
        throw new Error("changing report");
      total = page.total_records;
      rows.push(...page.participants);
      if (rows.length > 10000) throw new Error("report too large");
      next = page.next_page_token || "";
      if (typeof next !== "string" || (next && tokens.has(next)))
        throw new Error("invalid pagination");
      tokens.add(next);
    } while (next);
    if (rows.length !== total) throw new Error("incomplete report");
    const report = attendanceReport(
      rows,
      occurrence.start_time,
      occurrence.end_time,
      date,
    );
    const result = await admin.rpc("service_monday_import_attendance", {
      p_date: date,
      p_uuid: uuid,
      p_rows: report.accounts,
      p_unmatched: report.unmatched,
    });
    if (result.error) throw new Error("save failed");
    return reply({ ok: true });
  } catch {
    return reply(
      {
        error:
          "Could not reconcile a complete Zoom report. Previous results were preserved.",
      },
      502,
    );
  }
});
