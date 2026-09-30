-- =============================================================================
-- Account deletion works for members with video or plan-review history.
--
-- delete_own_account() removes auth.users and relies on cascades, but several
-- foreign keys were ON DELETE RESTRICT: a member who had ever requested a
-- private video session (their own request is a video_session_proposals row
-- with proposed_by_account_id = them) could not delete their account at all,
-- and paid plan reviews blocked deletion through plan_review_payment_events.
-- App Store Guideline 5.1.1(v) requires in-app deletion to succeed.
--
-- * Rows that die with the member anyway (their proposals, the session ->
--   booking link) keep the protective check but defer it to commit, so the
--   order in which cascades run no longer matters. Deleting a coach who still
--   has proposals on other members' sessions is still refused.
-- * Payment events are financial records: they survive with the session and
--   booking links cleared.
-- * Admin preparation notes survive an admin's deletion without an author.
-- =============================================================================

ALTER TABLE public.video_session_proposals
  DROP CONSTRAINT IF EXISTS video_session_proposals_proposed_by_account_id_fkey,
  ADD CONSTRAINT video_session_proposals_proposed_by_account_id_fkey
    FOREIGN KEY (proposed_by_account_id) REFERENCES public.accounts(id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.video_session_proposals
  DROP CONSTRAINT IF EXISTS video_session_proposals_coach_id_fkey,
  ADD CONSTRAINT video_session_proposals_coach_id_fkey
    FOREIGN KEY (coach_id) REFERENCES public.accounts(id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.video_sessions
  DROP CONSTRAINT IF EXISTS video_sessions_coaching_booking_id_fkey,
  ADD CONSTRAINT video_sessions_coaching_booking_id_fkey
    FOREIGN KEY (coaching_booking_id) REFERENCES public.coaching_bookings(id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.plan_review_payment_events
  ALTER COLUMN session_id DROP NOT NULL,
  ALTER COLUMN coaching_booking_id DROP NOT NULL;

ALTER TABLE public.plan_review_payment_events
  DROP CONSTRAINT IF EXISTS plan_review_payment_events_session_id_fkey,
  ADD CONSTRAINT plan_review_payment_events_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.video_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.plan_review_payment_events
  DROP CONSTRAINT IF EXISTS plan_review_payment_events_coaching_booking_id_fkey,
  ADD CONSTRAINT plan_review_payment_events_coaching_booking_id_fkey
    FOREIGN KEY (coaching_booking_id) REFERENCES public.coaching_bookings(id) ON DELETE SET NULL;

ALTER TABLE public.plan_review_admin_preparation
  ALTER COLUMN updated_by DROP NOT NULL;

ALTER TABLE public.plan_review_admin_preparation
  DROP CONSTRAINT IF EXISTS plan_review_admin_preparation_updated_by_fkey,
  ADD CONSTRAINT plan_review_admin_preparation_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES public.accounts(id) ON DELETE SET NULL;
