create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  title text not null,
  description text not null default '',
  audience text not null default 'parents',
  options jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  closes_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint polls_audience_check check (audience in ('parents', 'staff')),
  constraint polls_status_check check (status in ('open', 'closed'))
);

create index if not exists polls_club_team_audience_idx
on public.polls (club_id, team_id, audience, status);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  auth_user_id uuid references auth.users (id) on delete cascade,
  voter_email text not null,
  voter_name text,
  option_id text not null,
  parent_link_id uuid references public.parent_player_links (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists poll_votes_poll_email_unique
on public.poll_votes (poll_id, voter_email);

create index if not exists poll_votes_poll_idx
on public.poll_votes (poll_id, option_id);

alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;

grant select, insert, update, delete on public.polls to authenticated;
grant select, insert, update, delete on public.poll_votes to authenticated;

drop policy if exists polls_select_staff_scoped on public.polls;
create policy polls_select_staff_scoped
on public.polls
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists polls_insert_staff_scoped on public.polls;
create policy polls_insert_staff_scoped
on public.polls
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
  )
);

drop policy if exists polls_update_staff_scoped on public.polls;
create policy polls_update_staff_scoped
on public.polls
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
  )
);

drop policy if exists polls_delete_staff_scoped on public.polls;
create policy polls_delete_staff_scoped
on public.polls
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists poll_votes_select_staff_scoped on public.poll_votes;
create policy poll_votes_select_staff_scoped
on public.poll_votes
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists poll_votes_upsert_own_scoped on public.poll_votes;
create policy poll_votes_upsert_own_scoped
on public.poll_votes
for insert
to authenticated
with check (
  auth_user_id = auth.uid()
  and (
    public.current_user_role() = 'super_admin'
    or club_id = public.current_user_club_id()
  )
);

drop policy if exists poll_votes_update_own_scoped on public.poll_votes;
create policy poll_votes_update_own_scoped
on public.poll_votes
for update
to authenticated
using (
  auth_user_id = auth.uid()
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 50
  )
)
with check (
  auth_user_id = auth.uid()
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 50
  )
);

create or replace function public.get_parent_portal_polls(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  title text,
  description text,
  audience text,
  options jsonb,
  status text,
  closes_at timestamptz,
  created_at timestamptz,
  current_option_id text,
  votes jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with parent_link as (
    select *
    from public.parent_player_links
    where id = parent_link_id_value
      and auth_user_id = auth.uid()
      and status = 'active'
    limit 1
  )
  select
    poll.id,
    poll.club_id,
    poll.team_id,
    poll.title,
    poll.description,
    poll.audience,
    poll.options,
    poll.status,
    poll.closes_at,
    poll.created_at,
    own_vote.option_id as current_option_id,
    coalesce(
      jsonb_agg(
        jsonb_build_object('optionId', vote.option_id, 'count', vote.vote_count)
        order by vote.option_id
      ) filter (where vote.option_id is not null),
      '[]'::jsonb
    ) as votes
  from public.polls poll
  join parent_link link
    on link.club_id = poll.club_id
    and (poll.team_id is null or poll.team_id = link.team_id)
  left join public.poll_votes own_vote
    on own_vote.poll_id = poll.id
    and own_vote.auth_user_id = auth.uid()
  left join (
    select poll_id, option_id, count(*)::integer as vote_count
    from public.poll_votes
    group by poll_id, option_id
  ) vote
    on vote.poll_id = poll.id
  where auth.uid() is not null
    and poll.audience = 'parents'
    and poll.status = 'open'
    and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
  group by poll.id, own_vote.option_id
  order by poll.created_at desc;
$$;

grant execute on function public.get_parent_portal_polls(uuid) to authenticated;

create or replace function public.submit_parent_portal_poll_vote(
  parent_link_id_value uuid,
  poll_id_value uuid,
  option_id_value text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  poll_row public.polls%rowtype;
  voter_email_value text;
  vote_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Login is required before voting.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent poll could not be opened.';
  end if;

  select *
  into poll_row
  from public.polls
  where id = poll_id_value
    and club_id = link_row.club_id
    and audience = 'parents'
    and status = 'open'
    and (team_id is null or team_id = link_row.team_id)
    and (closes_at is null or closes_at > timezone('utc', now()))
  limit 1;

  if poll_row.id is null then
    raise exception 'This poll is no longer open.';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(poll_row.options) option_row
    where option_row ->> 'id' = option_id_value
  ) then
    raise exception 'Choose a valid poll option.';
  end if;

  voter_email_value := lower(coalesce(nullif(link_row.email, ''), auth.jwt() ->> 'email', auth.uid()::text));

  insert into public.poll_votes (
    poll_id,
    club_id,
    team_id,
    auth_user_id,
    voter_email,
    voter_name,
    option_id,
    parent_link_id
  )
  values (
    poll_row.id,
    poll_row.club_id,
    poll_row.team_id,
    auth.uid(),
    voter_email_value,
    coalesce(nullif(auth.jwt() ->> 'email', ''), voter_email_value),
    option_id_value,
    link_row.id
  )
  on conflict (poll_id, voter_email)
  do update set
    option_id = excluded.option_id,
    auth_user_id = excluded.auth_user_id,
    parent_link_id = excluded.parent_link_id,
    updated_at = timezone('utc', now())
  returning id into vote_id_value;

  return vote_id_value;
end;
$$;

grant execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text) to authenticated;
