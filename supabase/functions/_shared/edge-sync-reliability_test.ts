import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { parseWebMembership } from "./membership-validation.ts";
import { revenueCatMirror, sandboxAllowed } from "./revenuecat-validation.ts";
import { drainOutbox } from "./spine-drain.ts";

Deno.test("web requires an actual boolean (never revoke/grant from malformed JSON)", () => {
  assertEquals(parseWebMembership({ isMember: true }), true);
  assertEquals(parseWebMembership({ isMember: false }), false);
  for (
    const value of [null, {}, [], { isMember: "false" }, { isMember: 1 }, {
      isMember: null,
    }]
  ) {
    assertThrows(() => parseWebMembership(value));
  }
});
const now = Date.parse("2026-09-01T00:00:00Z");
function fixture() {
  const dates = {
    purchase_date: "2026-08-15T00:00:00Z",
    expires_date: "2026-09-15T00:00:00Z",
    grace_period_expires_date: null as string | null,
  };
  return {
    subscriber: {
      entitlements: {
        essential: { ...dates, product_identifier: "sh_essential_monthly" },
      },
      subscriptions: {
        sh_essential_monthly: {
          ...dates,
          is_sandbox: false,
          store: "app_store",
          refunded_at: null as string | null,
        },
      },
    },
  };
}
Deno.test("RC canonical production and explicitly allowed sandbox", () => {
  const body = fixture();
  assertEquals(revenueCatMirror(body, false, now), {
    essential: "2026-09-15T00:00:00.000Z",
  });
  body.subscriber.subscriptions.sh_essential_monthly.is_sandbox = true;
  assertEquals(revenueCatMirror(body, false, now), {});
  assertEquals(revenueCatMirror(body, true, now), {
    essential: "2026-09-15T00:00:00.000Z",
  });
  assertEquals(
    sandboxAllowed("a", "appreview@soberhelpline.com", true, ""),
    true,
  );
  assertEquals(
    sandboxAllowed("a", "appreview@soberhelpline.com", false, ""),
    false,
  );
  assertEquals(sandboxAllowed("a", "tester@example.com", true, "b, a"), true);
  assertEquals(sandboxAllowed("c", "tester@example.com", true, "b, a"), false);
});
Deno.test("RC does not borrow another transaction's environment or unknown products", () => {
  const body = fixture();
  body.subscriber.subscriptions.sh_essential_monthly.purchase_date =
    "2026-08-14T00:00:00Z";
  assertEquals(revenueCatMirror(body, true, now), {});
  body.subscriber.entitlements.essential.product_identifier = "unrelated";
  assertEquals(revenueCatMirror(body, true, now), {});
});
Deno.test("RC rejects refunded/expired/wrong-store grants and malformed responses", () => {
  for (
    const change of [{ refunded_at: "2026-08-31T00:00:00Z" }, {
      expires_date: "2026-08-31T00:00:00Z",
    }, { store: "promotional" }]
  ) {
    const body = fixture();
    Object.assign(body.subscriber.subscriptions.sh_essential_monthly, change);
    assertEquals(revenueCatMirror(body, false, now), {});
  }
  for (
    const body of [{}, { subscriber: {} }, {
      subscriber: { entitlements: {}, subscriptions: null },
    }]
  ) {
    assertThrows(() => revenueCatMirror(body, false, now));
  }
  const body = fixture();
  Object.assign(body.subscriber.subscriptions.sh_essential_monthly, {
    is_sandbox: "false",
  });
  assertThrows(() => revenueCatMirror(body, false, now));
  Object.assign(body.subscriber.entitlements.essential, { expires_date: null });
  assertThrows(() => revenueCatMirror(body, false, now));
});
Deno.test("RC honors matched billing grace but never outlives transaction", () => {
  const body = fixture();
  body.subscriber.entitlements.essential.grace_period_expires_date =
    "2026-09-20T00:00:00Z";
  body.subscriber.subscriptions.sh_essential_monthly.grace_period_expires_date =
    "2026-09-18T00:00:00Z";
  assertEquals(revenueCatMirror(body, false, now), {
    essential: "2026-09-18T00:00:00.000Z",
  });
});
const row = {
  id: 1,
  lease_token: "token",
  event_name: "payment",
  payload: { event: "spoof" },
};
Deno.test("outbox claims before bounded send, checks completion and uses stable key", async () => {
  const calls: string[] = [];
  let claimed = false;
  const result = await drainOutbox(
    (name, args) => {
      calls.push(name);
      if (name === "claim_spine_outbox") {
        const data = claimed ? [] : [row];
        claimed = true;
        return Promise.resolve({ data, error: null });
      }
      assertEquals(args?.p_token, "token");
      assertEquals(args?.p_sent, true);
      return Promise.resolve({ data: true, error: null });
    },
    "https://hub.invalid",
    "key",
    (_url, init) => {
      calls.push("send");
      assertEquals(
        new Headers(init?.headers).get("Idempotency-Key"),
        "soberhelpline-spine-1",
      );
      assertEquals(JSON.parse(String(init?.body)).event, "payment");
      assertEquals(init?.signal instanceof AbortSignal, true);
      return Promise.resolve(new Response(null, { status: 200 }));
    },
  );
  assertEquals(result, { processed: 1, sent: 1, failed: 0 });
  assertEquals(calls, [
    "claim_spine_outbox",
    "send",
    "complete_spine_outbox",
    "claim_spine_outbox",
  ]);
});
Deno.test("outbox stops on database error or stale completion, never reports sent", async () => {
  for (
    const completion of [{ data: false, error: null }, {
      data: null,
      error: { message: "write failed" },
    }]
  ) {
    await assertRejects(() =>
      drainOutbox(
        (name) =>
          Promise.resolve(
            name === "claim_spine_outbox"
              ? { data: [row], error: null }
              : completion,
          ),
        "https://hub.invalid",
        "key",
        () => Promise.resolve(new Response(null)),
      )
    );
  }
  await assertRejects(() =>
    drainOutbox(
      () => Promise.resolve({ data: null, error: { message: "claim failed" } }),
      "https://hub.invalid",
      "key",
      () => {
        throw new Error("must not send");
      },
    )
  );
});
Deno.test("outbox persists HTTP and timeout failures once", async () => {
  for (
    const send of [
      () => Promise.resolve(new Response(null, { status: 503 })),
      () => Promise.reject(new DOMException("timeout", "TimeoutError")),
    ]
  ) {
    let claimed = false;
    const result = await drainOutbox(
      (name, args) => {
        if (name === "claim_spine_outbox") {
          const data = claimed ? [] : [row];
          claimed = true;
          return Promise.resolve({ data, error: null });
        }
        assertEquals(args?.p_sent, false);
        assertEquals(typeof args?.p_error, "string");
        return Promise.resolve({ data: true, error: null });
      },
      "https://hub.invalid",
      "key",
      send,
    );
    assertEquals(result, { processed: 1, sent: 0, failed: 1 });
  }
});
