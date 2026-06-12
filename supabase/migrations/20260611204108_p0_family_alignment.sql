-- =============================================================================
-- P0 family alignment — family_spaces, family_members, shared_walls,
--   wall_commitments, wavering_events
-- RLS: members can read/write within spaces they belong to.
-- Max family size: 8 (enforced by application layer, not DB).
-- =============================================================================

CREATE TABLE family_spaces (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text  NOT NULL,
  created_by  uuid  NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  org_id      uuid  REFERENCES orgs(id),
  invite_code text  NOT NULL UNIQUE
    DEFAULT upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 4)
      || '-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 4)),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id  uuid NOT NULL REFERENCES family_spaces(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role             text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'member')),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_space_id, account_id)
);

CREATE TABLE shared_walls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id  uuid NOT NULL REFERENCES family_spaces(id) ON DELETE CASCADE,
  proposed_by      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text             text NOT NULL,
  anchor           text CHECK (anchor IN ('enabling', 'harm', 'both')),
  anchor_tag       text,
  source_wall_id   uuid REFERENCES walls(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wall_commitments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_wall_id uuid NOT NULL REFERENCES shared_walls(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'committed'
    CHECK (status IN ('committed', 'declined', 'wavering')),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shared_wall_id, account_id)
);

CREATE TABLE wavering_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_wall_id     uuid NOT NULL REFERENCES shared_walls(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shared_with_family bool NOT NULL DEFAULT false,
  coach_pinged       bool NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE family_spaces    ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_walls     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wall_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wavering_events  ENABLE ROW LEVEL SECURITY;

-- Helper: true if the current account is a member of the given family space
CREATE OR REPLACE FUNCTION is_family_member(space_id uuid)
RETURNS bool LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM family_members
    WHERE family_space_id = space_id AND account_id = my_account_id()
  )
$$;

-- family_spaces: members can read; owner can update; insert open (join flow)
CREATE POLICY "family_spaces: member select"
  ON family_spaces FOR SELECT
  USING (is_family_member(id));

CREATE POLICY "family_spaces: owner update"
  ON family_spaces FOR UPDATE
  USING     (created_by = my_account_id())
  WITH CHECK (created_by = my_account_id());

CREATE POLICY "family_spaces: anyone insert"
  ON family_spaces FOR INSERT
  WITH CHECK (created_by = my_account_id());

-- family_members: members of the space can read; anyone can insert (join)
CREATE POLICY "family_members: space member select"
  ON family_members FOR SELECT
  USING (is_family_member(family_space_id));

CREATE POLICY "family_members: self insert"
  ON family_members FOR INSERT
  WITH CHECK (account_id = my_account_id());

CREATE POLICY "family_members: self delete"
  ON family_members FOR DELETE
  USING (account_id = my_account_id());

-- shared_walls: space members can read + propose
CREATE POLICY "shared_walls: space member all"
  ON shared_walls FOR ALL
  USING     (is_family_member(family_space_id))
  WITH CHECK (is_family_member(family_space_id));

-- wall_commitments: space members can read; own commitment insert/update
CREATE POLICY "wall_commitments: space member select"
  ON wall_commitments FOR SELECT
  USING (is_family_member(
    (SELECT family_space_id FROM shared_walls WHERE id = shared_wall_id)
  ));

CREATE POLICY "wall_commitments: self insert"
  ON wall_commitments FOR INSERT
  WITH CHECK (account_id = my_account_id());

CREATE POLICY "wall_commitments: self update"
  ON wall_commitments FOR UPDATE
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id());

-- wavering_events: only the event creator sees their own; space members see
-- shared ones (shared_with_family = true)
CREATE POLICY "wavering_events: own or shared select"
  ON wavering_events FOR SELECT
  USING (
    account_id = my_account_id()
    OR (shared_with_family AND is_family_member(
      (SELECT family_space_id FROM shared_walls WHERE id = shared_wall_id)
    ))
  );

CREATE POLICY "wavering_events: self insert"
  ON wavering_events FOR INSERT
  WITH CHECK (account_id = my_account_id());
