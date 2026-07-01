-- =============================================================================
-- Admin-only live group hosting.
-- Only the owner admin account may start/stop live group broadcasts.
-- Viewers may still read live room status and RSVP for notifications.
-- =============================================================================

-- Remove any accidental non-admin host grants so old clients cannot become hosts.
delete from public.group_hosts gh
where not exists (
  select 1
  from public.accounts a
  join auth.users u on u.id = a.user_id
  where a.id = gh.account_id
    and lower(u.email) = 'matt@soberhelpline.com'
);

-- Ensure Matt is host for every moderated live room.
insert into public.group_hosts (room_name, account_id)
select r.room_name, a.id
from (values ('shp-parents'), ('shp-spouses'), ('shp-boundaries'), ('shp-treatment')) as r(room_name)
cross join public.accounts a
join auth.users u on u.id = a.user_id
where lower(u.email) = 'matt@soberhelpline.com'
on conflict do nothing;

-- Gate live-state changes by admin email, not just a group_hosts row.
create or replace function public.set_host_live(p_room_name text, p_is_live boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.group_hosts gh
  set is_live = p_is_live
  where gh.room_name = p_room_name
    and exists (
      select 1
      from public.accounts a
      join auth.users u on u.id = a.user_id
      where a.id = gh.account_id
        and a.user_id = auth.uid()
        and lower(u.email) = 'matt@soberhelpline.com'
    );
$$;
