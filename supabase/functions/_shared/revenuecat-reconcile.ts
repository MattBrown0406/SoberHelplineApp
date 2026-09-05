import { revenueCatMirror } from "./revenuecat-validation.ts";

// Both client-JWT and authenticated webhook paths use this authoritative lookup.
export async function fetchRevenueCatMirror(
  accountId: string,
  key: string,
  allowSandbox: boolean,
  send: typeof fetch = fetch,
) {
  const response = await send(
    `https://api.revenuecat.com/v1/subscribers/${
      encodeURIComponent(accountId)
    }`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`RevenueCat HTTP ${response.status}`);
  return revenueCatMirror(await response.json(), allowSandbox);
}

export async function revenueCatWebhook(
  req: Request,
  secret: string | undefined,
  reconcile: (id: string) => Promise<void>,
): Promise<Response> {
  // RevenueCat dashboard Authorization header must be EXACTLY Bearer <secret>.
  if (!secret?.trim()) {
    return new Response("webhook not configured", { status: 503 });
  }
  if (req.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  let event: Record<string, unknown>;
  try {
    const body = await req.json();
    if (!body?.event || typeof body.event.type !== "string") throw new Error();
    event = body.event;
  } catch {
    return new Response("invalid event", { status: 400 });
  }
  if (event.type === "TEST") return new Response("ok");
  // Transfers must reconcile BOTH sides. Aliases may include anonymous RC IDs;
  // only exact account UUIDs are looked up, and missing accounts are ignored.
  const candidates = [
    event.app_user_id,
    event.original_app_user_id,
    ...(Array.isArray(event.aliases) ? event.aliases : []),
    ...(Array.isArray(event.transferred_from) ? event.transferred_from : []),
    ...(Array.isArray(event.transferred_to) ? event.transferred_to : []),
  ];
  const ids = [
    ...new Set(candidates.filter((v): v is string =>
      typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    )),
  ];
  try {
    // No event expiry, environment, tier or refund claim is used to grant/revoke.
    await Promise.all(ids.map(reconcile));
    return new Response("ok");
  } catch {
    // Do not acknowledge failed reconciliation: RevenueCat retries non-200s.
    return new Response("reconciliation failed", { status: 502 });
  }
}
