-- The creator of a family space can SELECT it even before a family_members row
-- exists. Without this, INSERT...RETURNING fails because RETURNING goes through
-- the SELECT policy, and is_family_member() returns false until the owner row
-- is inserted.
CREATE POLICY "family_spaces: creator select"
  ON family_spaces FOR SELECT
  USING (created_by = my_account_id());
