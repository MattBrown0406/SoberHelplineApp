-- =============================================================================
-- P0 letter drafts
-- One draft per account per family member name.
-- Letter content is among the most sensitive data in the app:
-- excluded from analytics, never used for training, deleted with account.
-- =============================================================================

CREATE TABLE letter_drafts (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_name       text        NOT NULL,
  p1_body              text,
  p2_opener_label      text        NOT NULL DEFAULT
    'Your substance use has affected me in the following ways.',
  p2_experiences       jsonb       NOT NULL DEFAULT '[]',
  p3_request           text,
  p3_hope              text,
  p3_healthy_support   text,
  p3_boundaries        jsonb       NOT NULL DEFAULT '[]',
  p3_closing_question  text,
  status               text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'complete')),
  shared_with_coach    bool        NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, recipient_name)
);

ALTER TABLE letter_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "letter_drafts: owner all"
  ON letter_drafts FOR ALL
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id());
