-- Read-only family membership integrity audit.
-- Returns one JSON object and intentionally excludes names, emails, invite codes,
-- journal entries, and all other family content.

WITH
summary AS (
  SELECT
    (SELECT count(*) FROM family_spaces) AS family_spaces,
    (SELECT count(*) FROM family_members) AS memberships,
    (SELECT count(*)
       FROM family_members fm
       JOIN family_spaces fs ON fs.id = fm.family_space_id
      WHERE fm.role = 'owner' AND fm.account_id <> fs.created_by) AS non_creator_owners,
    (SELECT count(*)
       FROM family_spaces fs
      WHERE NOT EXISTS (
        SELECT 1 FROM family_members fm
         WHERE fm.family_space_id = fs.id
           AND fm.account_id = fs.created_by
           AND fm.role = 'owner'
      )) AS creators_missing_owner,
    (SELECT count(*) FROM (
        SELECT family_space_id FROM family_members
         GROUP BY family_space_id HAVING count(*) > 8
      ) oversized) AS oversized_spaces,
    (SELECT count(*) FROM (
        SELECT account_id FROM family_members
         GROUP BY account_id HAVING count(DISTINCT family_space_id) > 1
      ) multi) AS accounts_in_multiple_spaces,
    (SELECT count(*)
       FROM family_members fm
       JOIN family_spaces fs ON fs.id = fm.family_space_id
      WHERE fm.joined_at < fs.created_at) AS impossible_join_times,
    (SELECT count(*) FROM family_members WHERE role NOT IN ('owner', 'member')) AS invalid_roles
),
oversized AS (
  SELECT fs.id AS family_space_id, count(fm.*) AS member_count
    FROM family_spaces fs
    LEFT JOIN family_members fm ON fm.family_space_id = fs.id
   GROUP BY fs.id
  HAVING count(fm.*) > 8
),
multi_family AS (
  SELECT account_id, count(DISTINCT family_space_id) AS family_count
    FROM family_members
   GROUP BY account_id
  HAVING count(DISTINCT family_space_id) > 1
),
structural_anomalies AS (
  SELECT fm.id AS membership_id, fm.family_space_id, fm.account_id, fm.role,
         fm.joined_at, fs.created_by, fs.created_at
    FROM family_members fm
    JOIN family_spaces fs ON fs.id = fm.family_space_id
   WHERE (fm.role = 'owner' AND fm.account_id <> fs.created_by)
      OR fm.joined_at < fs.created_at
)
SELECT jsonb_build_object(
  'summary', (SELECT to_jsonb(summary) FROM summary),
  'oversized_spaces', COALESCE((SELECT jsonb_agg(to_jsonb(oversized)) FROM oversized), '[]'::jsonb),
  'accounts_in_multiple_spaces', COALESCE((SELECT jsonb_agg(to_jsonb(multi_family)) FROM multi_family), '[]'::jsonb),
  'structural_anomalies', COALESCE((SELECT jsonb_agg(to_jsonb(structural_anomalies)) FROM structural_anomalies), '[]'::jsonb)
) AS family_membership_audit;
