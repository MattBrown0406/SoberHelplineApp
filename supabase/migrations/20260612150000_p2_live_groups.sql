-- =============================================================================
-- P2: live groups — host assignments + per-group LiveKit room names
-- The token edge function reads group_hosts to decide who may broadcast/moderate.
-- =============================================================================

CREATE TABLE group_hosts (
  room_name  text        NOT NULL,
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_name, account_id)
);
ALTER TABLE group_hosts ENABLE ROW LEVEL SECURITY;
-- Readable by anyone signed in (so the app can show a "Host" badge);
-- writes happen via service role / dashboard only.
CREATE POLICY "group_hosts: authenticated read" ON group_hosts FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Map the four moderated groups to stable LiveKit room names.
-- (Groups currently render from app config; these room names are the contract
--  the live screen and token function share.)
-- Room names: shp-parents | shp-spouses | shp-boundaries | shp-treatment

-- Seed Matt as host of all four (his account_id once he signs in — placeholder
-- via email lookup; re-run/adjust after his account row exists).
INSERT INTO group_hosts (room_name, account_id)
SELECT r.room_name, a.id
FROM (VALUES ('shp-parents'), ('shp-spouses'), ('shp-boundaries'), ('shp-treatment')) AS r(room_name)
CROSS JOIN accounts a
JOIN auth.users u ON u.id = a.user_id
WHERE u.email = 'matt@soberhelpline.com'
ON CONFLICT DO NOTHING;
