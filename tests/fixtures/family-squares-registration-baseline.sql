-- Minimal isolated PostgreSQL fixture; not a substitute for full-chain release replay.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.session_rsvps(session_id text, account_id text, status text, created_at timestamptz DEFAULT now(), PRIMARY KEY(session_id,account_id));
CREATE TABLE public.session_join_links(session_id text, account_id text, starts_at timestamptz);
CREATE FUNCTION public.family_squares_session_id() RETURNS text LANGUAGE sql AS $$ SELECT 'english'::text $$;
CREATE FUNCTION public.la_sobremesa_session_id() RETURNS text LANGUAGE sql AS $$ SELECT 'spanish'::text $$;
