alter table private.live_match_follows alter column activity_token drop not null;
alter table private.live_match_follows add column start_token text
  check (start_token is null or (platform = 'ios' and length(start_token) between 64 and 256 and start_token ~ '^[0-9a-fA-F]+$'));
alter table private.live_match_follows add column remote_start_sent_at timestamptz;
alter table private.live_match_follows add column remote_start_attempted_at timestamptz;
alter table private.live_match_follows add column remote_start_rejected_at timestamptz;
alter table private.live_match_follows add column remote_start_attempt_count integer not null default 0;
alter table private.live_match_follows add column handoff_secret_hash text
  check (handoff_secret_hash is null or handoff_secret_hash ~ '^[0-9a-f]{64}$');
alter table private.live_match_follows add column badge_data text
  check (badge_data is null or (length(badge_data) <= 3000 and badge_data ~ '^[A-Za-z0-9+/=]+$'));
alter table private.live_match_follows add column club_is_home boolean;
alter table private.live_match_follows add column fan_connection_id uuid
  references public.fan_connections(id) on delete cascade;
alter table private.live_match_follows drop constraint live_match_parent_scope;
alter table private.live_match_follows add constraint live_match_follow_scope check (
  (app_role = 'coach' and parent_link_id is null and fan_connection_id is null)
  or (app_role = 'parent' and ((parent_link_id is not null) <> (fan_connection_id is not null)))
);
alter table private.live_match_follows add constraint live_match_follows_has_token
  check (activity_token is not null or start_token is not null);
create unique index live_match_follows_start_token_key
  on private.live_match_follows(user_id, session_id, match_day_id, app_role)
  where start_token is not null;

create table private.live_activity_start_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  app_role text not null check (app_role in ('coach', 'parent')),
  scope_type text not null check (scope_type in ('team', 'parent_link', 'fan_connection')),
  scope_id uuid not null,
  start_token text not null check (length(start_token) between 64 and 256 and start_token ~ '^[0-9a-f]+$'),
  badge_data text check (badge_data is null or (length(badge_data) <= 3000 and badge_data ~ '^[A-Za-z0-9+/=]+$')),
  updated_at timestamptz not null default now(),
  unique (user_id, session_id, app_role, scope_type, scope_id),
  constraint live_activity_start_subscription_scope check (
    (app_role = 'coach' and scope_type = 'team') or
    (app_role = 'parent' and scope_type in ('parent_link', 'fan_connection'))
  )
);
create index live_activity_start_subscriptions_scope_idx
  on private.live_activity_start_subscriptions(scope_type, scope_id);
alter table private.live_activity_start_subscriptions enable row level security;
revoke all on private.live_activity_start_subscriptions from public, anon, authenticated;

create table private.live_activity_start_suppressions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  match_day_id uuid not null references public.match_days(id) on delete cascade,
  app_role text not null check (app_role in ('coach', 'parent')),
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, match_day_id, app_role)
);
alter table private.live_activity_start_suppressions enable row level security;
revoke all on private.live_activity_start_suppressions from public, anon, authenticated;

create function public.register_live_activity_start_subscription(app_role_value text, scope_type_value text,
  scope_id_value uuid, start_token_value text, badge_data_value text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  session_id_value uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  allowed boolean := false;
  fan public.fan_connections%rowtype;
begin
  if auth.uid() is null or session_id_value is null or not exists (
    select 1 from auth.sessions s where s.id = session_id_value and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
  ) then raise exception 'Active session is required.' using errcode = '42501'; end if;
  if start_token_value is null or length(start_token_value) not between 64 and 256
    or start_token_value !~ '^[0-9a-fA-F]+$' or scope_id_value is null
    or (badge_data_value is not null and (length(badge_data_value) > 3000 or badge_data_value !~ '^[A-Za-z0-9+/=]+$')) then
    raise exception 'Invalid Live Activity registration.' using errcode = '22023';
  end if;
  if app_role_value = 'coach' and scope_type_value = 'team' then
    allowed := coalesce(public.can_read_match_day(scope_id_value), false)
      and public.current_user_role() not in ('parent_portal', 'adult_player');
  elsif app_role_value = 'parent' and scope_type_value = 'parent_link' then
    allowed := exists (select 1 from public.parent_player_links link
      where link.id = scope_id_value and link.auth_user_id = auth.uid()
        and link.status = 'active' and link.link_type = 'parent');
  elsif app_role_value = 'parent' and scope_type_value = 'fan_connection' then
    select * into fan from public.fan_connections where id = scope_id_value and auth_user_id = auth.uid();
    allowed := fan.id is not null and fan.status = 'active' and fan.notifications_enabled
      and fan.permissions->>'game_day' = 'true'
      and app_private.fan_scope_active(fan.parent_link_id, fan.player_id, fan.club_id, fan.invited_by)
      and app_private.fan_account_active(auth.uid(), fan.club_id);
  end if;
  if not allowed then raise exception 'Match access is required.' using errcode = '42501'; end if;
  insert into private.live_activity_start_subscriptions(user_id, session_id, app_role,
    scope_type, scope_id, start_token, badge_data)
  values (auth.uid(), session_id_value, app_role_value, scope_type_value, scope_id_value,
    lower(start_token_value), badge_data_value)
  on conflict (user_id, session_id, app_role, scope_type, scope_id)
  do update set start_token = excluded.start_token, badge_data = excluded.badge_data, updated_at = now();
  return true;
end;
$$;
revoke all on function public.register_live_activity_start_subscription(text,text,uuid,text,text) from public, anon;
grant execute on function public.register_live_activity_start_subscription(text,text,uuid,text,text) to authenticated;

create function public.revoke_live_activity_start_subscriptions(app_role_value text)
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if auth.uid() is null or app_role_value not in ('coach', 'parent') then
    raise exception 'Sign in to stop Live Activities.' using errcode = '42501'; end if;
  delete from private.live_activity_start_subscriptions
    where user_id = auth.uid() and app_role = app_role_value;
  get diagnostics removed = row_count;
  delete from private.live_match_follows where user_id = auth.uid()
    and session_id = nullif(auth.jwt()->>'session_id', '')::uuid and app_role = app_role_value;
  return removed;
end;
$$;
revoke all on function public.revoke_live_activity_start_subscriptions(text) from public, anon;
grant execute on function public.revoke_live_activity_start_subscriptions(text) to authenticated;

create or replace function private.queue_live_match_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (exists (select 1 from private.live_match_follows where match_day_id = new.id)
    or (new.status = 'live' and old.status is distinct from new.status))
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

create function public.claim_registered_live_match_starts(match_day_id_value uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  match_row public.match_days%rowtype;
  subscription private.live_activity_start_subscriptions%rowtype;
  parent_id uuid;
  fan_id uuid;
  fan public.fan_connections%rowtype;
  allowed boolean;
  inserted_count integer := 0;
  previous_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  select * into match_row from public.match_days where id = match_day_id_value;
  if match_row.id is null or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or match_row.deleted_at is not null or match_row.previous_hidden_at is not null
    or match_row.concluded_at is not null then return 0; end if;
  for subscription in
    select s.* from private.live_activity_start_subscriptions s
    join auth.sessions session on session.id = s.session_id and session.user_id = s.user_id
    where (session.not_after is null or session.not_after > now()) and (
      (s.scope_type = 'team' and s.scope_id = match_row.team_id)
      or (s.scope_type = 'parent_link' and exists (
        select 1 from public.parent_player_links l where l.id = s.scope_id and l.club_id = match_row.club_id))
      or (s.scope_type = 'fan_connection' and exists (
        select 1 from public.fan_connections f where f.id = s.scope_id and f.club_id = match_row.club_id))
    )
  loop
    parent_id := null;
    fan_id := null;
    allowed := false;
    perform set_config('request.jwt.claim.sub', subscription.user_id::text, true);
    if subscription.scope_type = 'team' and subscription.scope_id = match_row.team_id then
      allowed := coalesce(public.can_read_match_day(match_row.team_id), false)
        and public.current_user_role() not in ('parent_portal', 'adult_player');
    elsif subscription.scope_type = 'parent_link' then
      allowed := exists (select 1 from public.get_parent_portal_match_days(subscription.scope_id) visible
        where visible.id = match_day_id_value);
      if allowed then parent_id := subscription.scope_id; end if;
    elsif subscription.scope_type = 'fan_connection' then
      select * into fan from public.fan_connections where id = subscription.scope_id
        and auth_user_id = subscription.user_id;
      allowed := fan.id is not null and fan.status = 'active' and fan.notifications_enabled
        and fan.permissions->>'game_day' = 'true' and fan.club_id = match_row.club_id
        and exists (select 1 from public.players p where p.id = fan.player_id and p.team_id = match_row.team_id)
        and app_private.fan_scope_active(fan.parent_link_id, fan.player_id, fan.club_id, fan.invited_by)
        and app_private.fan_account_active(subscription.user_id, fan.club_id);
      if allowed then fan_id := fan.id; end if;
    end if;
    if not allowed or exists (select 1 from private.live_activity_start_suppressions blocked
      where blocked.user_id = subscription.user_id and blocked.session_id = subscription.session_id
        and blocked.match_day_id = match_day_id_value and blocked.app_role = subscription.app_role) then continue; end if;
    update private.live_match_follows existing
      set start_token = subscription.start_token,
        remote_start_attempted_at = case when existing.start_token is distinct from subscription.start_token
          then null else existing.remote_start_attempted_at end,
        remote_start_rejected_at = case when existing.start_token is distinct from subscription.start_token
          then null else existing.remote_start_rejected_at end,
        remote_start_attempt_count = case when existing.start_token is distinct from subscription.start_token
          then 0 else existing.remote_start_attempt_count end,
        handoff_secret_hash = case when existing.start_token is distinct from subscription.start_token
          then null else existing.handoff_secret_hash end, updated_at = now()
      where existing.user_id = subscription.user_id and existing.session_id = subscription.session_id
        and existing.match_day_id = match_day_id_value and existing.app_role = subscription.app_role
        and existing.start_token is not null and existing.activity_token is null
        and (existing.remote_start_attempted_at is null
          or (existing.remote_start_rejected_at is not null
            and existing.start_token is distinct from subscription.start_token));
    if found then continue; end if;
    if exists (select 1 from private.live_match_follows existing
      where existing.user_id = subscription.user_id and existing.session_id = subscription.session_id
        and existing.match_day_id = match_day_id_value and existing.app_role = subscription.app_role) then continue; end if;
    insert into private.live_match_follows(user_id, session_id, match_day_id, parent_link_id,
      fan_connection_id, app_role, platform, activity_token, start_token, badge_data, club_is_home)
    values (subscription.user_id, subscription.session_id, match_day_id_value, parent_id,
      fan_id, subscription.app_role, 'ios', null, subscription.start_token, subscription.badge_data,
      coalesce(match_row.home_away, '') <> 'away')
    on conflict (user_id, session_id, match_day_id, app_role) where start_token is not null
    do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  return inserted_count;
end;
$$;
revoke all on function public.claim_registered_live_match_starts(uuid) from public, anon, authenticated;
grant execute on function public.claim_registered_live_match_starts(uuid) to service_role;

create or replace function public.stop_following_live_match(follow_id_value uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target private.live_match_follows%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to stop following a match.' using errcode = '42501'; end if;
  select * into target from private.live_match_follows where id = follow_id_value
    and user_id = auth.uid() for update;
  if target.id is null then return false; end if;
  insert into private.live_activity_start_suppressions(user_id, session_id, match_day_id, app_role)
    values (target.user_id, target.session_id, target.match_day_id, target.app_role)
    on conflict do nothing;
  delete from private.live_match_follows where id = follow_id_value;
  return true;
end;
$$;
revoke all on function public.stop_following_live_match(uuid) from public, anon;
grant execute on function public.stop_following_live_match(uuid) to authenticated;

create or replace function public.attach_live_match_activity(follow_id_value uuid, activity_token_value text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target private.live_match_follows%rowtype;
  match_row public.match_days%rowtype;
  fan public.fan_connections%rowtype;
begin
  if auth.uid() is null or length(activity_token_value) not between 64 and 256
    or activity_token_value !~ '^[0-9a-fA-F]+$' then
    raise exception 'Invalid live match request.' using errcode = '22023';
  end if;
  select * into target from private.live_match_follows where id = follow_id_value
    and user_id = auth.uid() and session_id = nullif(auth.jwt()->>'session_id', '')::uuid
    and platform = 'ios' and start_token is not null for update;
  if target.id is null then return false; end if;
  if exists (select 1 from private.live_match_follows existing where existing.id <> target.id
    and existing.user_id = target.user_id and existing.match_day_id = target.match_day_id
    and existing.app_role = target.app_role and existing.activity_token = lower(activity_token_value)) then return false; end if;
  select * into match_row from public.match_days where id = target.match_day_id;
  if match_row.id is null or match_row.deleted_at is not null or match_row.previous_hidden_at is not null
    or match_row.status in ('cancelled', 'postponed') or match_row.concluded_at is not null then return false; end if;
  if target.app_role = 'coach' then
    if not coalesce(public.can_read_match_day(match_row.team_id), false)
      or public.current_user_role() in ('parent_portal', 'adult_player') then return false; end if;
  elsif target.parent_link_id is not null then
    if not exists (select 1 from public.get_parent_portal_match_days(target.parent_link_id) visible
      where visible.id = target.match_day_id) then return false; end if;
  else
    select * into fan from public.fan_connections where id = target.fan_connection_id
      and auth_user_id = target.user_id;
    if fan.id is null or fan.status <> 'active' or not fan.notifications_enabled
      or fan.permissions->>'game_day' <> 'true' or fan.club_id <> match_row.club_id
      or not exists (select 1 from public.players p where p.id = fan.player_id and p.team_id = match_row.team_id)
      or not app_private.fan_scope_active(fan.parent_link_id, fan.player_id, fan.club_id, fan.invited_by)
      or not app_private.fan_account_active(target.user_id, fan.club_id) then return false; end if;
  end if;
  update private.live_match_follows set activity_token = lower(activity_token_value), updated_at = now()
    where id = follow_id_value;
  return true;
end;
$$;
revoke all on function public.attach_live_match_activity(uuid,text) from public, anon;
grant execute on function public.attach_live_match_activity(uuid,text) to authenticated;

drop function public.get_live_match_follows_for_delivery(uuid);
create function public.get_live_match_follows_for_delivery(match_day_id_value uuid)
returns table(follow_id uuid, app_role text, platform text, activity_token text,
  start_token text, remote_start_sent_at timestamptz, remote_start_attempted_at timestamptz, badge_data text,
  club_is_home boolean, access_allowed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  follower private.live_match_follows%rowtype;
  match_row public.match_days%rowtype;
  fan public.fan_connections%rowtype;
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
    if follower.activity_token is null and exists (
      select 1 from private.live_match_follows active_follow
      where active_follow.id <> follower.id and active_follow.user_id = follower.user_id
        and active_follow.session_id = follower.session_id
        and active_follow.match_day_id = follower.match_day_id
        and active_follow.app_role = follower.app_role and active_follow.activity_token is not null
    ) then continue; end if;
    perform set_config('request.jwt.claim.sub', follower.user_id::text, true);
    if follower.app_role = 'coach' then
      can_follow := coalesce(public.can_read_match_day(match_row.team_id), false)
        and public.current_user_role() not in ('parent_portal', 'adult_player');
    elsif follower.parent_link_id is not null then
      can_follow := exists (select 1 from public.get_parent_portal_match_days(follower.parent_link_id) visible
        where visible.id = match_day_id_value);
    else
      select * into fan from public.fan_connections where id = follower.fan_connection_id
        and auth_user_id = follower.user_id;
      can_follow := fan.id is not null and fan.status = 'active' and fan.notifications_enabled
        and fan.permissions->>'game_day' = 'true' and fan.club_id = match_row.club_id
        and exists (select 1 from public.players p where p.id = fan.player_id and p.team_id = match_row.team_id)
        and app_private.fan_scope_active(fan.parent_link_id, fan.player_id, fan.club_id, fan.invited_by)
        and app_private.fan_account_active(follower.user_id, fan.club_id);
    end if;
    follow_id := follower.id;
    app_role := follower.app_role;
    platform := follower.platform;
    activity_token := follower.activity_token;
    start_token := follower.start_token;
    remote_start_sent_at := follower.remote_start_sent_at;
    remote_start_attempted_at := follower.remote_start_attempted_at;
    badge_data := follower.badge_data;
    club_is_home := follower.club_is_home;
    access_allowed := can_follow;
    return next;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
end;
$$;
revoke all on function public.get_live_match_follows_for_delivery(uuid) from public, anon, authenticated;
grant execute on function public.get_live_match_follows_for_delivery(uuid) to service_role;

create function public.reserve_live_match_remote_start(follow_id_value uuid, start_token_value text,
  handoff_secret_hash_value text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  if handoff_secret_hash_value !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.live_match_follows set remote_start_attempted_at = now(),
    remote_start_attempt_count = remote_start_attempt_count + 1,
    remote_start_rejected_at = null,
    handoff_secret_hash = handoff_secret_hash_value, updated_at = now()
    where id = follow_id_value and start_token = lower(start_token_value) and activity_token is null
      and remote_start_attempted_at is null returning id into updated_id;
  return updated_id is not null;
end;
$$;
revoke all on function public.reserve_live_match_remote_start(uuid,text,text) from public, anon, authenticated;
grant execute on function public.reserve_live_match_remote_start(uuid,text,text) to service_role;

create function public.reject_live_match_remote_start(follow_id_value uuid, start_token_value text,
  retryable_value boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  update private.live_match_follows set
    remote_start_attempted_at = case when retryable_value and remote_start_attempt_count < 3
      then null else remote_start_attempted_at end,
    remote_start_rejected_at = now(), handoff_secret_hash = null, updated_at = now()
    where id = follow_id_value and start_token = lower(start_token_value)
      and remote_start_attempted_at is not null and remote_start_sent_at is null
      and activity_token is null returning id into updated_id;
  return updated_id is not null;
end;
$$;
revoke all on function public.reject_live_match_remote_start(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.reject_live_match_remote_start(uuid,text,boolean) to service_role;

create function public.mark_live_match_remote_started(follow_id_value uuid, start_token_value text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  update private.live_match_follows set remote_start_sent_at = now(), updated_at = now()
    where id = follow_id_value and start_token = lower(start_token_value)
      and remote_start_attempted_at is not null and remote_start_sent_at is null
      returning id into updated_id;
  return updated_id is not null;
end;
$$;
revoke all on function public.mark_live_match_remote_started(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_live_match_remote_started(uuid,text) to service_role;

create function public.attach_live_match_activity_from_push(follow_id_value uuid,
  handoff_secret_hash_value text, activity_token_value text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target private.live_match_follows%rowtype;
begin
  if auth.role() <> 'service_role' or handoff_secret_hash_value !~ '^[0-9a-f]{64}$'
    or length(activity_token_value) not between 64 and 256
    or activity_token_value !~ '^[0-9a-fA-F]+$' then return false; end if;
  select * into target from private.live_match_follows where id = follow_id_value for update;
  if target.id is null or target.platform <> 'ios' or target.handoff_secret_hash is distinct from handoff_secret_hash_value
    or target.remote_start_attempted_at is null or not exists (
      select 1 from auth.sessions session where session.id = target.session_id and session.user_id = target.user_id
        and (session.not_after is null or session.not_after > now())) then return false; end if;
  if not exists (select 1 from public.get_live_match_follows_for_delivery(target.match_day_id) visible
    where visible.follow_id = target.id and visible.access_allowed) then return false; end if;
  if exists (select 1 from private.live_match_follows existing where existing.id <> target.id
    and existing.activity_token = lower(activity_token_value)) then return false; end if;
  update private.live_match_follows set activity_token = lower(activity_token_value),
    updated_at = now() where id = target.id;
  return true;
end;
$$;
revoke all on function public.attach_live_match_activity_from_push(uuid,text,text) from public, anon, authenticated;
grant execute on function public.attach_live_match_activity_from_push(uuid,text,text) to service_role;
