create table public.mobile_test_coach_push_installations (
  installation_id uuid primary key,
  environment text not null default 'test' check (environment = 'test'),
  auth_user_id uuid references auth.users (id) on delete set null,
  context_id text not null,
  expo_push_token text unique,
  platform text not null check (platform in ('android', 'ios')),
  app_version text not null default '',
  build_number text not null default '',
  detail_level text not null default 'minimal' check (detail_level in ('off', 'minimal', 'detailed')),
  enabled boolean not null default false,
  status text not null default 'unbound' check (status in ('active', 'unbound', 'revoked')),
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index mobile_test_coach_push_installations_auth_status_idx
on public.mobile_test_coach_push_installations (auth_user_id, status)
where auth_user_id is not null;

create index mobile_test_coach_push_installations_context_idx
on public.mobile_test_coach_push_installations (context_id, status);

alter table public.mobile_test_coach_push_installations enable row level security;
alter table public.mobile_test_coach_push_installations force row level security;
revoke all on public.mobile_test_coach_push_installations from public, anon, authenticated;

create or replace function public.mobile_test_coach_context_allowed(p_context_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = (select auth.uid())
      and u.status = 'active'
      and u.role in ('assistant_coach', 'coach', 'manager', 'head_manager', 'admin')
      and (
        (
          p_context_id = 'club:' || u.club_id::text
          and u.role = 'admin'
        )
        or exists (
          select 1
          from public.team_staff ts
          join public.teams t on t.id = ts.team_id
          where ts.user_id = u.id
            and t.club_id = u.club_id
            and p_context_id = 'team:' || t.id::text
        )
      )
  );
$$;

create or replace function public.register_mobile_test_coach_push_installation(
  p_installation_id uuid,
  p_context_id text,
  p_expo_push_token text,
  p_platform text,
  p_app_version text,
  p_build_number text,
  p_detail_level text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  existing_owner uuid;
begin
  if caller_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not public.mobile_test_coach_context_allowed(p_context_id) then raise exception 'coach_context_required' using errcode = '42501'; end if;
  if p_platform not in ('android', 'ios')
    or p_detail_level not in ('minimal', 'detailed')
    or p_expo_push_token !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'
    or length(p_expo_push_token) > 512
  then raise exception 'invalid_installation_registration' using errcode = '22023'; end if;

  select auth_user_id into existing_owner
  from public.mobile_test_coach_push_installations
  where installation_id = p_installation_id;
  if existing_owner is not null and existing_owner <> caller_id then raise exception 'installation_owned_by_another_user' using errcode = '42501'; end if;

  update public.mobile_test_coach_push_installations
  set expo_push_token = null, enabled = false, status = 'revoked', updated_at = timezone('utc', now())
  where expo_push_token = p_expo_push_token and installation_id <> p_installation_id;

  insert into public.mobile_test_coach_push_installations (
    installation_id, auth_user_id, context_id, expo_push_token, platform, app_version, build_number,
    detail_level, enabled, status, last_seen_at, updated_at
  ) values (
    p_installation_id, caller_id, p_context_id, p_expo_push_token, p_platform,
    left(coalesce(p_app_version, ''), 40), left(coalesce(p_build_number, ''), 40),
    p_detail_level, true, 'active', timezone('utc', now()), timezone('utc', now())
  ) on conflict (installation_id) do update
  set auth_user_id = excluded.auth_user_id,
      context_id = excluded.context_id,
      expo_push_token = excluded.expo_push_token,
      platform = excluded.platform,
      app_version = excluded.app_version,
      build_number = excluded.build_number,
      detail_level = excluded.detail_level,
      enabled = true,
      status = 'active',
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at;

  return jsonb_build_object('contextId', p_context_id, 'detailLevel', p_detail_level, 'enabled', true, 'platform', p_platform, 'registered', true);
end;
$$;

create or replace function public.get_mobile_test_coach_push_installation(p_installation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'contextId', i.context_id,
      'detailLevel', i.detail_level,
      'enabled', i.enabled and i.status = 'active',
      'platform', i.platform,
      'registered', i.status = 'active'
    )
    from public.mobile_test_coach_push_installations i
    where i.installation_id = p_installation_id
      and i.auth_user_id = (select auth.uid())
  ), jsonb_build_object('detailLevel', 'minimal', 'enabled', false, 'registered', false));
$$;

create or replace function public.update_mobile_test_coach_push_preference(
  p_installation_id uuid,
  p_context_id text,
  p_enabled boolean,
  p_detail_level text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not public.mobile_test_coach_context_allowed(p_context_id) then raise exception 'coach_context_required' using errcode = '42501'; end if;
  if p_detail_level not in ('off', 'minimal', 'detailed') then raise exception 'invalid_notification_detail' using errcode = '22023'; end if;

  update public.mobile_test_coach_push_installations
  set context_id = p_context_id,
      detail_level = p_detail_level,
      enabled = p_enabled and p_detail_level <> 'off',
      last_seen_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where installation_id = p_installation_id and auth_user_id = caller_id;
  if not found then raise exception 'installation_not_available' using errcode = '42501'; end if;
  return jsonb_build_object('contextId', p_context_id, 'detailLevel', p_detail_level, 'enabled', p_enabled and p_detail_level <> 'off', 'registered', true);
end;
$$;

create or replace function public.unbind_mobile_test_coach_push_installation(p_installation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  update public.mobile_test_coach_push_installations
  set auth_user_id = null, expo_push_token = null, enabled = false, status = 'unbound', updated_at = timezone('utc', now())
  where installation_id = p_installation_id and auth_user_id = (select auth.uid());
  return found;
end;
$$;

revoke all on function public.mobile_test_coach_context_allowed(text) from public, anon, authenticated;
revoke all on function public.register_mobile_test_coach_push_installation(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.get_mobile_test_coach_push_installation(uuid) from public, anon;
revoke all on function public.update_mobile_test_coach_push_preference(uuid, text, boolean, text) from public, anon;
revoke all on function public.unbind_mobile_test_coach_push_installation(uuid) from public, anon;
grant execute on function public.register_mobile_test_coach_push_installation(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.get_mobile_test_coach_push_installation(uuid) to authenticated;
grant execute on function public.update_mobile_test_coach_push_preference(uuid, text, boolean, text) to authenticated;
grant execute on function public.unbind_mobile_test_coach_push_installation(uuid) to authenticated;
