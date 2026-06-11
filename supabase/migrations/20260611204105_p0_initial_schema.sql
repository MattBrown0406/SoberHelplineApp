-- =============================================================================
-- P0 initial schema — Sober Helpline
-- Tables: orgs (stub), accounts, checkins, walls, tracker_logs, consents
-- RLS:    default deny; owner-only policies on every table
-- Trigger: auto-create accounts row on auth.users INSERT
-- =============================================================================

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Orgs stub ────────────────────────────────────────────────────────────────
-- Full orgs/staff/branding tables land in P1.
-- This stub exists so accounts.org_id has a valid FK target.
CREATE TABLE orgs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  status     text        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Accounts ─────────────────────────────────────────────────────────────────
-- One row per authenticated user; created automatically by the trigger below.
-- type 'attached'|'direct' — entitlements table (P1) resolves essential/premium.
CREATE TABLE accounts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text        NOT NULL DEFAULT 'direct'
               CHECK (type IN ('attached', 'direct')),
  org_id     uuid        REFERENCES orgs(id),
  first_name text,
  last_name  text,
  language   text        NOT NULL DEFAULT 'en',
  timezone   text        NOT NULL DEFAULT 'America/New_York',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Check-ins ────────────────────────────────────────────────────────────────
-- One check-in per account per UTC calendar day (enforced by the unique index).
CREATE TABLE checkins (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mood       smallint    NOT NULL CHECK (mood BETWEEN 1 AND 5),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Prevents duplicate check-ins for the same day.
-- Client de-duplication is the first line; this is the safety net.
CREATE UNIQUE INDEX checkins_account_day
  ON checkins (account_id, (created_at AT TIME ZONE 'UTC')::date);

-- ─── Walls (boundary walls) ───────────────────────────────────────────────────
CREATE TABLE walls (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text                 text        NOT NULL,
  anchor               text        CHECK (anchor IN ('enabling', 'harm', 'both')),
  anchor_tag           text,
  shared_with_coach_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── Tracker logs ─────────────────────────────────────────────────────────────
-- Normalised: one row per sign per week.
CREATE TABLE tracker_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sign_key   text        NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('warning', 'recovery')),
  week       date        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, sign_key, week)
);

-- ─── Consents ledger ──────────────────────────────────────────────────────────
-- Keys 1-9 per docs/legal/consent-architecture.md.
-- Revoke by setting revoked_at; DELETE is blocked by RLS.
CREATE TABLE consents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  consent_key text        NOT NULL,
  version     text        NOT NULL DEFAULT '1.0',
  granted_at  timestamptz,
  revoked_at  timestamptz,
  UNIQUE (account_id, consent_key)
);

COMMENT ON TABLE consents IS
  'Consent ledger — keys 1-9 per docs/legal/consent-architecture.md. '
  'Revoke by setting revoked_at. Row deletion is blocked by RLS.';

-- ─── Account creation trigger ─────────────────────────────────────────────────
-- Fires on every auth.users INSERT so the accounts row exists before the
-- client finishes the signup flow. Handles email, Apple, and future OAuth.
CREATE OR REPLACE FUNCTION create_account_for_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.accounts (user_id, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_account_for_user();

-- ─── Row-level security ───────────────────────────────────────────────────────
-- Default deny on every table. Coach access is a P1 addition.

ALTER TABLE orgs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE walls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracker_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents     ENABLE ROW LEVEL SECURITY;

-- Resolves accounts.id for the calling JWT. SECURITY DEFINER so it can read
-- accounts regardless of the calling policy context.
CREATE OR REPLACE FUNCTION my_account_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.accounts WHERE user_id = auth.uid()
$$;

-- accounts: read and update own row; INSERT handled by trigger (service role)
CREATE POLICY "accounts: owner select"
  ON accounts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "accounts: owner update"
  ON accounts FOR UPDATE
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- checkins: full CRUD on own rows
CREATE POLICY "checkins: owner all"
  ON checkins FOR ALL
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id());

-- walls: full CRUD on own rows
CREATE POLICY "walls: owner all"
  ON walls FOR ALL
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id());

-- tracker_logs: full CRUD on own rows
CREATE POLICY "tracker_logs: owner all"
  ON tracker_logs FOR ALL
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id());

-- consents: read + write own rows; no DELETE policy = hard-delete blocked
CREATE POLICY "consents: owner select"
  ON consents FOR SELECT
  USING (account_id = my_account_id());

CREATE POLICY "consents: owner insert"
  ON consents FOR INSERT
  WITH CHECK (account_id = my_account_id());

CREATE POLICY "consents: owner update"
  ON consents FOR UPDATE
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id());
