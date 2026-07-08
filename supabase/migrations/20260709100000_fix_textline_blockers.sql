-- =============================================================================
-- Fixes for feature/emergency-textline review blockers:
--
-- 1. update_thread_message_rollup ran as the invoking user; members have no
--    UPDATE policy on threads, so RLS silently zeroed the update for member
--    sends (timestamps only advanced when admin replied). SECURITY DEFINER
--    lets the trigger maintain rollups regardless of sender.
--
-- 2. IAP subscribers (RevenueCat) had no entitlements rows, so the new
--    has_active_textline_access / has_active_private_video_access gates locked
--    paying App Store subscribers out. The sync-iap-entitlements edge function
--    (server-verified against the RevenueCat REST API) now maintains
--    source='revenuecat' rows; nothing schema-side needed beyond the existing
--    CHECK, which already allows 'revenuecat'.
-- =============================================================================

CREATE OR REPLACE FUNCTION update_thread_message_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE threads
  SET
    last_message_at = NEW.created_at,
    last_member_message_at = CASE WHEN NEW.sender_role = 'member' THEN NEW.created_at ELSE last_member_message_at END,
    last_coach_message_at = CASE WHEN NEW.sender_role IN ('coach', 'ai') THEN NEW.created_at ELSE last_coach_message_at END
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;
