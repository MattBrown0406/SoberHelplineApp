-- Family members can post short notes visible to the whole family space.

CREATE TABLE family_journal_entries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id  uuid        NOT NULL REFERENCES family_spaces(id) ON DELETE CASCADE,
  account_id       uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  note             text        NOT NULL CHECK (length(note) BETWEEN 1 AND 280),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE family_journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family_journal: space member select" ON family_journal_entries FOR SELECT
  USING (
    family_space_id IN (
      SELECT family_space_id FROM family_members WHERE account_id = my_account_id()
    )
  );

CREATE POLICY "family_journal: space member insert" ON family_journal_entries FOR INSERT
  WITH CHECK (
    account_id = my_account_id()
    AND family_space_id IN (
      SELECT family_space_id FROM family_members WHERE account_id = my_account_id()
    )
  );
