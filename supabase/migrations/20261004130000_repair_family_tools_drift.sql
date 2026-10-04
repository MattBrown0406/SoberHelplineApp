-- 20260813120000_family_behavior_tools.sql was edited after it had already run
-- in production (commit f4b14e1), so production never got these two changes:
--
-- 1. wavering_events.notification_claimed_at — notify-family-backup claims it
--    before sending, and retry_notification_deliveries() reads it. Without it
--    the "tell my family I'm wavering" push never sends and the per-minute
--    shl-notification-retry job fails on every run.
-- 2. The wall_hold_logs insert/update policies that only allow a family space
--    the member still belongs to (production kept the original, owner-only
--    checks).
-- Re-runnable.

ALTER TABLE public.wavering_events
  ADD COLUMN IF NOT EXISTS notification_claimed_at timestamptz;

DROP POLICY IF EXISTS "wall_hold_logs: self insert" ON public.wall_hold_logs;
CREATE POLICY "wall_hold_logs: self insert"
  ON public.wall_hold_logs FOR INSERT
  WITH CHECK (
    account_id = public.my_account_id()
    AND (
      family_space_id IS NULL
      OR public.is_family_member(family_space_id)
    )
    AND (NOT shared_with_family OR family_space_id IS NOT NULL)
  );

DROP POLICY IF EXISTS "wall_hold_logs: self update" ON public.wall_hold_logs;
CREATE POLICY "wall_hold_logs: self update"
  ON public.wall_hold_logs FOR UPDATE
  USING (account_id = public.my_account_id())
  WITH CHECK (
    account_id = public.my_account_id()
    AND (
      family_space_id IS NULL
      OR public.is_family_member(family_space_id)
    )
    AND (NOT shared_with_family OR family_space_id IS NOT NULL)
  );
