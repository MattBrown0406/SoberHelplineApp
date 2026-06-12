-- =============================================================================
-- P1: Monday Zoom link + paid 1:1 coaching bookings
-- =============================================================================

-- "The Family Squares" — Monday Night Family Support.
-- NOTE: currently scheduled in Zoom as weekly one-time meetings, so this URL
-- rotates each week. Action item: convert to a RECURRING meeting in Zoom
-- (fixed meeting ID) and update once — or wire the P2 zoom-sync edge function.
UPDATE sessions
SET zoom_url = 'https://us06web.zoom.us/j/81199116141?pwd=rFCGvcdhyIvSWIKvtBWbr8Dz3zmRbK.1',
    next_at  = '2026-06-16T02:00:00Z'
WHERE title = 'Monday Night Family Support';

-- ─── 1:1 coaching bookings ($150/hr) ─────────────────────────────────────────
-- Payment: PayPal (external), under App Store guideline 3.1.3(d) — real-time
-- person-to-person services between two individuals may use non-IAP payment.
-- payment_status flips to 'paid' manually (or via PayPal webhook in P2);
-- Matt confirms, sets scheduled_at + zoom_url from the dashboard.
CREATE TABLE coaching_bookings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  preferred_times text        NOT NULL,
  note            text,
  status          text        NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','confirmed','completed','cancelled')),
  payment_status  text        NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','paid','refunded')),
  rate_cents      integer     NOT NULL DEFAULT 15000,
  scheduled_at    timestamptz,
  zoom_url        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coaching_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_bookings: owner select" ON coaching_bookings FOR SELECT
  USING (account_id = my_account_id());
CREATE POLICY "coaching_bookings: owner insert" ON coaching_bookings FOR INSERT
  WITH CHECK (account_id = my_account_id());
-- Cancel only; confirmation/payment updates come from the dashboard (service role).
CREATE POLICY "coaching_bookings: owner cancel" ON coaching_bookings FOR UPDATE
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id() AND status IN ('requested','cancelled'));
