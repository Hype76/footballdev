create schema if not exists private;

create table private.live_match_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  match_day_id uuid not null references public.match_days(id) on delete cascade,
  parent_link_id uuid references public.parent_player_links(id) on delete cascade,
  app_role text not null check (app_role in ('coach', 'parent')),
  platform text not null check (platform in ('ios', 'android')),
  activity_token text not null check (
    (platform = 'ios' and length(activity_token) between 64 and 256 and activity_token ~ '^[0-9a-fA-F]+$')
    or (platform = 'android' and activity_token ~ '^ExpoPushToken\[[A-Za-z0-9_-]{16,128}\]$')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_day_id, app_role, platform, activity_token),
  constraint live_match_parent_scope check ((app_role = 'parent') = (parent_link_id is not null))
);

create index live_match_follows_match_idx on private.live_match_follows(match_day_id);
alter table private.live_match_follows enable row level security;
revoke all on private.live_match_follows from public, anon, authenticated;

create table private.live_match_changes (
  id bigint generated always as identity primary key,
  match_day_id uuid not null references public.match_days(id) on delete cascade,
  changed_at timestamptz not null default now(),
  attempts integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  completed_at timestamptz
);
create index live_match_changes_pending_idx on private.live_match_changes(id) where completed_at is null;
alter table private.live_match_changes enable row level security;
revoke all on private.live_match_changes from public, anon, authenticated;

create or replace function private.queue_live_match_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.live_match_follows where match_day_id = new.id)
    and (new.status, new.home_score, new.away_score, new.timer_status,
      new.timer_started_at, new.timer_elapsed_seconds, new.current_match_phase,
      new.home_shootout_score, new.away_shootout_score, new.concluded_at,
      new.deleted_at, new.previous_hidden_at)
    is distinct from
    (old.status, old.home_score, old.away_score, old.timer_status,
      old.timer_started_at, old.timer_elapsed_seconds, old.current_match_phase,
      old.home_shootout_score, old.away_shootout_score, old.concluded_at,
      old.deleted_at, old.previous_hidden_at) then
    insert into private.live_match_changes(match_day_id) values (new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists queue_live_match_change on public.match_days;
create trigger queue_live_match_change after update on public.match_days
for each row execute function private.queue_live_match_change();

create or replace function public.follow_live_match(match_day_id_value uuid, app_role_value text, platform_value text, activity_token_value text, parent_link_id_value uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  match_row public.match_days%rowtype;
  follow_id uuid;
  session_id_value uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to follow a match.' using errcode = '42501'; end if;
  if session_id_value is null or not exists (
    select 1 from auth.sessions s where s.id = session_id_value and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
  ) then raise exception 'Active session is required to follow a match.' using errcode = '42501'; end if;
  if app_role_value not in ('coach', 'parent') or platform_value not in ('ios', 'android')
    or (platform_value = 'ios' and (length(activity_token_value) not between 64 and 256 or activity_token_value !~ '^[0-9a-fA-F]+$'))
    or (platform_value = 'android' and activity_token_value !~ '^ExpoPushToken\[[A-Za-z0-9_-]{16,128}\]$') then
    raise exception 'Invalid live match request.' using errcode = '22023';
  end if;
  select * into match_row from public.match_days where id = match_day_id_value;
  if match_row.id is null or match_row.deleted_at is not null or match_row.previous_hidden_at is not null
    or match_row.status in ('cancelled', 'postponed') or match_row.concluded_at is not null then
    raise exception 'This match is unavailable.' using errcode = '42501';
  end if;
  if app_role_value = 'coach' then
    if parent_link_id_value is not null or not coalesce(public.can_read_match_day(match_row.team_id), false)
      or public.current_user_role() in ('parent_portal', 'adult_player') then
      raise exception 'Match access is required.' using errcode = '42501';
    end if;
  elsif parent_link_id_value is null or not exists (
    select 1 from public.get_parent_portal_match_days(parent_link_id_value) visible where visible.id = match_day_id_value
  ) then
    raise exception 'Match access is required.' using errcode = '42501';
  end if;
  insert into private.live_match_follows(user_id, session_id, match_day_id, parent_link_id, app_role, platform, activity_token)
    values (auth.uid(), session_id_value, match_day_id_value, parent_link_id_value, app_role_value, platform_value,
      case when platform_value = 'ios' then lower(activity_token_value) else activity_token_value end)
    on conflict (user_id, match_day_id, app_role, platform, activity_token)
    do update set updated_at = now(), parent_link_id = excluded.parent_link_id, session_id = excluded.session_id
    returning id into follow_id;
  return follow_id;
end;
$$;

revoke all on function public.follow_live_match(uuid,text,text,text,uuid) from public, anon;
grant execute on function public.follow_live_match(uuid,text,text,text,uuid) to authenticated;

create or replace function public.stop_following_live_match(follow_id_value uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare deleted_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to stop following a match.' using errcode = '42501'; end if;
  delete from private.live_match_follows where id = follow_id_value and user_id = auth.uid() returning id into deleted_id;
  return deleted_id is not null;
end;
$$;

revoke all on function public.stop_following_live_match(uuid) from public, anon;
grant execute on function public.stop_following_live_match(uuid) to authenticated;

create or replace function public.is_live_match_follow_active(follow_id_value uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.live_match_follows f
    where f.id = follow_id_value and f.user_id = auth.uid()
      and f.session_id = nullif(auth.jwt()->>'session_id', '')::uuid
  );
$$;
revoke all on function public.is_live_match_follow_active(uuid) from public, anon;
grant execute on function public.is_live_match_follow_active(uuid) to authenticated;

create or replace function public.get_live_match_follows_for_delivery(match_day_id_value uuid)
returns table(follow_id uuid, app_role text, platform text, activity_token text, access_allowed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  follower private.live_match_follows%rowtype;
  match_row public.match_days%rowtype;
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  can_follow boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service access is required.' using errcode = '42501';
  end if;
  select * into match_row from public.match_days where id = match_day_id_value;
  if match_row.id is null then return; end if;
  for follower in select f.* from private.live_match_follows f
    join auth.sessions s on s.id = f.session_id
    where f.match_day_id = match_day_id_value
      and (s.not_after is null or s.not_after > now()) loop
    perform set_config('request.jwt.claim.sub', follower.user_id::text, true);
    if follower.app_role = 'coach' then
      can_follow := coalesce(public.can_read_match_day(match_row.team_id), false)
        and public.current_user_role() not in ('parent_portal', 'adult_player');
    else
      can_follow := exists (
        select 1 from public.get_parent_portal_match_days(follower.parent_link_id) visible
        where visible.id = match_day_id_value
      );
    end if;
    follow_id := follower.id;
    app_role := follower.app_role;
    platform := follower.platform;
    activity_token := follower.activity_token;
    access_allowed := can_follow;
    return next;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
end;
$$;

revoke all on function public.get_live_match_follows_for_delivery(uuid) from public, anon, authenticated;
grant execute on function public.get_live_match_follows_for_delivery(uuid) to service_role;

create or replace function public.claim_live_match_changes(batch_size integer default 20)
returns table(change_id bigint, match_day_id uuid) language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  return query
    with pending as (
      select c.id from private.live_match_changes c
      where c.completed_at is null and c.next_attempt_at <= now()
        and (c.claimed_at is null or c.claimed_at < now() - interval '2 minutes')
      order by c.id limit least(greatest(coalesce(batch_size, 20), 1), 50)
      for update skip locked
    )
    update private.live_match_changes c
    set claimed_at = now(), attempts = c.attempts + 1
    from pending where c.id = pending.id
    returning c.id, c.match_day_id;
end;
$$;
revoke all on function public.claim_live_match_changes(integer) from public, anon, authenticated;
grant execute on function public.claim_live_match_changes(integer) to service_role;

create or replace function public.complete_live_match_change(change_id_value bigint, successful boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  update private.live_match_changes
  set completed_at = case when successful then now() else null end,
      claimed_at = null,
      next_attempt_at = case when successful then next_attempt_at
        else now() + make_interval(secs => least(power(2, least(attempts, 8))::integer, 300)) end
  where id = change_id_value and completed_at is null;
end;
$$;
revoke all on function public.complete_live_match_change(bigint,boolean) from public, anon, authenticated;
grant execute on function public.complete_live_match_change(bigint,boolean) to service_role;

create or replace function public.enqueue_live_match_heartbeats()
returns integer language plpgsql security definer set search_path = '' as $$
declare queued_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  delete from private.live_match_follows f where not exists (
    select 1 from auth.sessions s where s.id = f.session_id
      and (s.not_after is null or s.not_after > now())
  );
  insert into private.live_match_changes(match_day_id)
  select match_row.id
  from public.match_days match_row
  where match_row.status in ('live', 'second_half', 'extra_time', 'penalties')
    and match_row.deleted_at is null and match_row.concluded_at is null
    and exists (select 1 from private.live_match_follows f where f.match_day_id = match_row.id)
    and not exists (
      select 1 from private.live_match_changes c
      where c.match_day_id = match_row.id and c.changed_at > now() - interval '3 minutes'
    )
  limit 20;
  get diagnostics queued_count = row_count;
  return queued_count;
end;
$$;
revoke all on function public.enqueue_live_match_heartbeats() from public, anon, authenticated;
grant execute on function public.enqueue_live_match_heartbeats() to service_role;
