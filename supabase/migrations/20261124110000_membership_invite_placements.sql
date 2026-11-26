-- Two more places a free member may be offered a look at membership (app 4.4):
--   tool_finished  she finished a free tool (holiday plan, intervention letter,
--                  letter to a prosecutor)
--   checkin_week   her check-in streak reached five days
--
-- Only the list of known source labels changes: the two labels are added so
-- the server keeps them instead of storing 'unknown'. Everything else about
-- the membership path (stages, what is kept, the admin figures) is unchanged
-- from 20261114130000_membership_path_funnel. src/lib/membershipPath.ts
-- (PLAN_SOURCES) mirrors this list.

-- Where she came from. Screen and card names only; never anything she wrote.
CREATE OR REPLACE FUNCTION public._membership_path_sources()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'after_meeting', 'boundary_saved', 'chat_gate', 'checkin_week', 'crisis_command_plan', 'crisis_plan_review',
    'diy_planner', 'feature_gate', 'invitation_engine', 'invitation_setup', 'learn_library',
    'membership_guide', 'practice_completed', 'rehearsal_gate', 'settings', 'support_groups',
    'support_tab', 'support_upgrade', 'today_locked_preview', 'today_membership', 'tool_finished', 'tracker_share'
  ]::text[];
$$;
REVOKE EXECUTE ON FUNCTION public._membership_path_sources() FROM PUBLIC, anon, authenticated;
