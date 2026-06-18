-- Members can submit questions for a session; admin reviews them before the call.

CREATE TABLE session_questions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id  uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question    text        NOT NULL CHECK (length(question) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE session_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_questions: owner insert" ON session_questions FOR INSERT
  WITH CHECK (account_id = my_account_id());

CREATE POLICY "session_questions: owner select" ON session_questions FOR SELECT
  USING (account_id = my_account_id());

-- Admin RPC — gated to owner email.
CREATE OR REPLACE FUNCTION admin_get_session_questions(p_session_title text DEFAULT 'Monday Night Family Support')
RETURNS TABLE(id uuid, first_name text, last_name text, question text, submitted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT sq.id, a.first_name, a.last_name, sq.question, sq.created_at
  FROM session_questions sq
  JOIN accounts a ON a.id  = sq.account_id
  JOIN sessions  s ON s.id  = sq.session_id
  WHERE s.title = p_session_title
  ORDER BY sq.created_at DESC;
END;
$$;
