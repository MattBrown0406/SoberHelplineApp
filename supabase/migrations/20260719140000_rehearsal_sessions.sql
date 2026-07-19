-- Saved practice sessions: families can review past reps (transcript + coaching).
-- Owner-only via RLS; deleting an account cascades its sessions away.

create table if not exists public.rehearsal_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  source_id text,
  scenario jsonb not null default '{}'::jsonb,
  transcript jsonb not null default '[]'::jsonb,
  debrief jsonb
);

comment on table public.rehearsal_sessions is 'AI practice partner sessions saved for user review. Transcript entries: {role: user|partner, text}. No audio is ever stored.';

create index if not exists rehearsal_sessions_account_created_idx
  on public.rehearsal_sessions (account_id, created_at desc);

alter table public.rehearsal_sessions enable row level security;

create policy "own sessions: select" on public.rehearsal_sessions
  for select using (
    account_id in (select id from public.accounts where user_id = auth.uid())
  );

create policy "own sessions: insert" on public.rehearsal_sessions
  for insert with check (
    account_id in (select id from public.accounts where user_id = auth.uid())
  );

create policy "own sessions: delete" on public.rehearsal_sessions
  for delete using (
    account_id in (select id from public.accounts where user_id = auth.uid())
  );
