import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  fetchRevenueCatMirror,
  revenueCatWebhook,
} from "./revenuecat-reconcile.ts";
const a = "15000000-0000-0000-0000-000000000001",
  b = "15000000-0000-0000-0000-000000000002";
function request(event: unknown, auth = "Bearer secret") {
  return new Request("https://test.invalid", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({ event }),
  });
}
Deno.test("webhook fails closed before any work", async () => {
  let calls = 0;
  const run = async () => {
    calls++;
  };
  assertEquals(
    (await revenueCatWebhook(request({ type: "TEST" }), undefined, run)).status,
    503,
  );
  assertEquals(
    (await revenueCatWebhook(
      request({ type: "CANCELLATION", app_user_id: a }, "Bearer client-jwt"),
      "secret",
      run,
    )).status,
    401,
  );
  assertEquals(calls, 0);
});
Deno.test("refund and transfer webhook re-fetch accounts, dedupe aliases, retry failures", async () => {
  const calls: string[] = [];
  const event = {
    type: "TRANSFER",
    transferred_from: [a],
    transferred_to: [b],
    aliases: [a, "$RCAnonymousID:test"],
  };
  assertEquals(
    (await revenueCatWebhook(request(event), "secret", async (id) => {
      calls.push(id);
    })).status,
    200,
  );
  assertEquals(calls.sort(), [a, b]);
  assertEquals(
    (await revenueCatWebhook(
      request({ type: "CANCELLATION", app_user_id: a }),
      "secret",
      async () => {
        throw Error("upstream");
      },
    )).status,
    502,
  );
});
Deno.test("authoritative refund removes prior mirror without trusting webhook grant claims", async () => {
  let mirror: Record<string, string> = { essential: "2099-01-01T00:00:00Z" };
  const dates = {
    purchase_date: "2026-01-01T00:00:00Z",
    expires_date: "2099-01-01T00:00:00Z",
  };
  const response = {
    subscriber: {
      entitlements: {
        essential: { ...dates, product_identifier: "sh_essential_monthly" },
      },
      subscriptions: {
        sh_essential_monthly: {
          ...dates,
          store: "app_store",
          is_sandbox: false,
          refunded_at: "2026-02-01T00:00:00Z",
        },
      },
    },
  };
  const run = async (id: string) => {
    mirror = await fetchRevenueCatMirror(
      id,
      "server-key",
      false,
      async (_url, init) => {
        assertEquals(
          new Headers(init?.headers).get("Authorization"),
          "Bearer server-key",
        );
        return Response.json(response);
      },
    );
  };
  assertEquals(
    (await revenueCatWebhook(
      request({
        type: "CANCELLATION",
        app_user_id: a,
        entitlement_ids: ["premium"],
        expiration_at_ms: 9999999999999,
      }),
      "secret",
      run,
    )).status,
    200,
  );
  assertEquals(mirror, {});
  assertEquals(
    (await revenueCatWebhook(
      request({ type: "CANCELLATION", app_user_id: a }),
      "secret",
      run,
    )).status,
    200,
  );
  assertEquals(mirror, {});
});
Deno.test("authoritative transient/malformed failures preserve state; 404 revokes", async () => {
  for (
    const response of [
      new Response(null, { status: 503 }),
      Response.json({ subscriber: {} }),
    ]
  ) {
    await assertRejects(() =>
      fetchRevenueCatMirror(a, "key", false, () => Promise.resolve(response))
    );
  }
  assertEquals(
    await fetchRevenueCatMirror(
      a,
      "key",
      false,
      () => Promise.resolve(new Response(null, { status: 404 })),
    ),
    {},
  );
});
