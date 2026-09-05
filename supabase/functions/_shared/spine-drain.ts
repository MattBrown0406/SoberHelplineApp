type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;
type Claim = {
  id: number;
  lease_token: string;
  event_name: string;
  payload: Record<string, unknown>;
};

export async function drainOutbox(
  rpc: Rpc,
  hubUrl: string,
  hubKey: string,
  send = fetch,
) {
  const results = { processed: 0, sent: 0, failed: 0 };
  const deadline = Date.now() + 45_000;
  for (let i = 0; i < 50 && Date.now() < deadline; i++) {
    const claimed = await rpc("claim_spine_outbox");
    if (claimed.error) throw new Error(claimed.error.message);
    if (!Array.isArray(claimed.data)) {
      throw new Error("invalid outbox claim response");
    }
    if (claimed.data.length === 0) break;
    if (claimed.data.length !== 1) {
      throw new Error("invalid outbox claim count");
    }
    const row = claimed.data[0] as Claim;
    let sent = false;
    let error: string | null = null;
    try {
      const response = await send(hubUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${hubKey}`,
          // Stable across retries. Hub must honor this for crash-safe deduplication.
          "Idempotency-Key": `soberhelpline-spine-${row.id}`,
        },
        body: JSON.stringify({ ...row.payload, event: row.event_name }),
        signal: AbortSignal.timeout(10_000),
      });
      sent = response.ok;
      if (!sent) error = `HTTP ${response.status}`;
      // Do not download an unbounded error body or leave a connection open.
      await response.body?.cancel();
    } catch (err) {
      error = String(err).slice(0, 500);
      sent = false;
    }
    const completed = await rpc("complete_spine_outbox", {
      p_id: row.id,
      p_token: row.lease_token,
      p_sent: sent,
      p_error: error,
    });
    // A successful transport response is NOT a successful persisted completion.
    if (completed.error || completed.data !== true) {
      throw new Error(
        completed.error?.message ?? "outbox lease lost before completion",
      );
    }
    results.processed++;
    if (sent) results.sent++;
    else results.failed++;
  }
  return results;
}
