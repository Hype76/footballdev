create table public.mobile_test_parent_push_allowlist (
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  installation_id uuid,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (auth_user_id, platform),
  constraint mobile_test_parent_push_allowlist_platform_check
    check (platform in ('android', 'ios')),
  constraint mobile_test_parent_push_allowlist_installation_key
    unique (installation_id)
);

create table public.mobile_test_parent_push_installations (
  installation_id uuid primary key,
  environment text not null default 'test',
  auth_user_id uuid references auth.users (id) on delete set null,
  parent_link_id uuid references public.parent_player_links (id) on delete set null,
  expo_push_token text,
  platform text not null,
  app_version text not null default '',
  build_number text not null default '',
  detail_level text not null default 'minimal',
  enabled boolean not null default false,
  status text not null default 'unbound',
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mobile_test_parent_push_installations_environment_check
    check (environment = 'test'),
  constraint mobile_test_parent_push_installations_platform_check
    check (platform in ('android', 'ios')),
  constraint mobile_test_parent_push_installations_detail_check
    check (detail_level in ('minimal', 'detailed')),
  constraint mobile_test_parent_push_installations_status_check
    check (status in ('active', 'unbound', 'revoked')),
  constraint mobile_test_parent_push_installations_token_key
    unique (expo_push_token)
);

create index mobile_test_parent_push_installations_auth_status_idx
on public.mobile_test_parent_push_installations (auth_user_id, status)
where auth_user_id is not null;

create index mobile_test_parent_push_installations_parent_link_idx
on public.mobile_test_parent_push_installations (parent_link_id)
where parent_link_id is not null;

create table public.mobile_test_parent_push_audit (
  id bigint generated always as identity primary key,
  auth_user_id uuid references auth.users (id) on delete set null,
  installation_id uuid references public.mobile_test_parent_push_installations (installation_id) on delete set null,
  intent_type text not null,
  installation_count integer not null default 0,
  result_category text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint mobile_test_parent_push_audit_intent_check
    check (intent_type in ('parent_message', 'parent_poll', 'matchday_update')),
  constraint mobile_test_parent_push_audit_count_check
    check (installation_count between 0 and 2),
  constraint mobile_test_parent_push_audit_result_check
    check (result_category in ('sent', 'failed', 'rejected', 'skipped'))
);

create index mobile_test_parent_push_audit_auth_created_idx
on public.mobile_test_parent_push_audit (auth_user_id, created_at desc)
where auth_user_id is not null;

create index mobile_test_parent_push_audit_installation_idx
on public.mobile_test_parent_push_audit (installation_id)
where installation_id is not null;

alter table public.mobile_test_parent_push_allowlist enable row level security;
alter table public.mobile_test_parent_push_allowlist force row level security;
alter table public.mobile_test_parent_push_installations enable row level security;
alter table public.mobile_test_parent_push_installations force row level security;
alter table public.mobile_test_parent_push_audit enable row level security;
alter table public.mobile_test_parent_push_audit force row level security;

revoke all on public.mobile_test_parent_push_allowlist from public, anon, authenticated;
revoke all on public.mobile_test_parent_push_installations from public, anon, authenticated;
revoke all on public.mobile_test_parent_push_audit from public, anon, authenticated;

create or replace function public.register_mobile_test_parent_push_installation(
  p_installation_id uuid,
  p_parent_link_id uuid,
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
  allowed_installation_id uuid;
  existing_owner_id uuid;
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_platform is null
    or p_platform not in ('android', 'ios')
    or p_detail_level is null
    or p_detail_level not in ('minimal', 'detailed')
    or p_expo_push_token is null
    or p_expo_push_token !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'
    or length(p_expo_push_token) > 512
  then
    raise exception 'invalid_installation_registration' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = caller_id
      and u.role = 'parent_portal'
      and u.status = 'active'
  ) then
    raise exception 'parent_authority_required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.parent_player_links ppl
    where ppl.id = p_parent_link_id
      and ppl.auth_user_id = caller_id
      and ppl.status = 'active'
  ) then
    raise exception 'active_parent_link_required' using errcode = '42501';
  end if;

  select a.installation_id
  into allowed_installation_id
  from public.mobile_test_parent_push_allowlist a
  where a.auth_user_id = caller_id
    and a.platform = p_platform
    and a.enabled = true
  for update;

  if not found then
    raise exception 'test_installation_not_allowlisted' using errcode = '42501';
  end if;

  if allowed_installation_id is not null and allowed_installation_id <> p_installation_id then
    raise exception 'test_installation_slot_already_claimed' using errcode = '42501';
  end if;

  select i.auth_user_id
  into existing_owner_id
  from public.mobile_test_parent_push_installations i
  where i.installation_id = p_installation_id;

  if existing_owner_id is not null and existing_owner_id <> caller_id then
    raise exception 'installation_owned_by_another_user' using errcode = '42501';
  end if;

  update public.mobile_test_parent_push_allowlist
  set installation_id = p_installation_id,
      updated_at = timezone('utc', now())
  where auth_user_id = caller_id
    and platform = p_platform;

  update public.mobile_test_parent_push_installations
  set expo_push_token = null,
      enabled = false,
      status = 'revoked',
      updated_at = timezone('utc', now())
  where expo_push_token = p_expo_push_token
    and installation_id <> p_installation_id;

  insert into public.mobile_test_parent_push_installations (
    installation_id,
    environment,
    auth_user_id,
    parent_link_id,
    expo_push_token,
    platform,
    app_version,
    build_number,
    detail_level,
    enabled,
    status,
    last_seen_at,
    updated_at
  ) values (
    p_installation_id,
    'test',
    caller_id,
    p_parent_link_id,
    p_expo_push_token,
    p_platform,
    left(coalesce(p_app_version, ''), 40),
    left(coalesce(p_build_number, ''), 40),
    p_detail_level,
    true,
    'active',
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (installation_id) do update
  set auth_user_id = excluded.auth_user_id,
      parent_link_id = excluded.parent_link_id,
      expo_push_token = excluded.expo_push_token,
      platform = excluded.platform,
      app_version = excluded.app_version,
      build_number = excluded.build_number,
      detail_level = excluded.detail_level,
      enabled = true,
      status = 'active',
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'detailLevel', p_detail_level,
    'enabled', true,
    'platform', p_platform,
    'registered', true
  );
end;
$$;

create or replace function public.get_mobile_test_parent_push_installation(
  p_installation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'detailLevel', i.detail_level,
        'enabled', i.enabled and i.status = 'active',
        'platform', i.platform,
        'registered', i.status = 'active'
      )
      from public.mobile_test_parent_push_installations i
      where i.installation_id = p_installation_id
        and i.auth_user_id = (select auth.uid())
    ),
    jsonb_build_object(
      'detailLevel', 'minimal',
      'enabled', false,
      'registered', false
    )
  );
$$;

create or replace function public.update_mobile_test_parent_push_preference(
  p_installation_id uuid,
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
  updated_count integer;
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_detail_level is null or p_detail_level not in ('minimal', 'detailed') then
    raise exception 'invalid_notification_detail' using errcode = '22023';
  end if;

  update public.mobile_test_parent_push_installations i
  set enabled = p_enabled,
      detail_level = p_detail_level,
      status = case when p_enabled then 'active' else i.status end,
      last_seen_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where i.installation_id = p_installation_id
    and i.auth_user_id = caller_id
    and exists (
      select 1
      from public.mobile_test_parent_push_allowlist a
      where a.auth_user_id = caller_id
        and a.platform = i.platform
        and a.installation_id = i.installation_id
        and a.enabled = true
    );

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'installation_not_available' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'detailLevel', p_detail_level,
    'enabled', p_enabled,
    'registered', true
  );
end;
$$;

create or replace function public.unbind_mobile_test_parent_push_installation(
  p_installation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  update public.mobile_test_parent_push_installations
  set auth_user_id = null,
      parent_link_id = null,
      expo_push_token = null,
      enabled = false,
      status = 'unbound',
      updated_at = timezone('utc', now())
  where installation_id = p_installation_id
    and auth_user_id = caller_id;

  return found;
end;
$$;

create or replace function public.prepare_mobile_test_parent_push(
  p_installation_id uuid,
  p_intent_type text
)
returns table (
  expo_push_token text,
  detail_level text,
  platform text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_intent_type is null or p_intent_type not in ('parent_message', 'parent_poll', 'matchday_update') then
    raise exception 'unsupported_parent_notification_intent' using errcode = '22023';
  end if;

  return query
  select i.expo_push_token, i.detail_level, i.platform
  from public.mobile_test_parent_push_installations i
  join public.mobile_test_parent_push_allowlist a
    on a.auth_user_id = i.auth_user_id
   and a.platform = i.platform
   and a.installation_id = i.installation_id
   and a.enabled = true
  where i.installation_id = p_installation_id
    and i.auth_user_id = caller_id
    and i.environment = 'test'
    and i.status = 'active'
    and i.enabled = true
    and i.expo_push_token is not null
    and exists (
      select 1
      from public.users u
      where u.id = caller_id
        and u.role = 'parent_portal'
        and u.status = 'active'
    )
    and exists (
      select 1
      from public.parent_player_links ppl
      where ppl.auth_user_id = caller_id
        and ppl.status = 'active'
    );
end;
$$;

create or replace function public.record_mobile_test_parent_push_result(
  p_installation_id uuid,
  p_intent_type text,
  p_result_category text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_intent_type is null
    or p_intent_type not in ('parent_message', 'parent_poll', 'matchday_update')
    or p_result_category is null
    or p_result_category not in ('sent', 'failed', 'rejected', 'skipped')
  then
    raise exception 'invalid_parent_push_audit' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.mobile_test_parent_push_allowlist a
    where a.auth_user_id = caller_id
      and a.installation_id = p_installation_id
      and a.enabled = true
  ) then
    raise exception 'test_installation_not_allowlisted' using errcode = '42501';
  end if;

  insert into public.mobile_test_parent_push_audit (
    auth_user_id,
    installation_id,
    intent_type,
    installation_count,
    result_category
  ) values (
    caller_id,
    p_installation_id,
    p_intent_type,
    case when p_result_category = 'sent' then 1 else 0 end,
    p_result_category
  );

  return true;
end;
$$;

revoke all on function public.register_mobile_test_parent_push_installation(uuid, uuid, text, text, text, text, text) from public, anon;
revoke all on function public.get_mobile_test_parent_push_installation(uuid) from public, anon;
revoke all on function public.update_mobile_test_parent_push_preference(uuid, boolean, text) from public, anon;
revoke all on function public.unbind_mobile_test_parent_push_installation(uuid) from public, anon;
revoke all on function public.prepare_mobile_test_parent_push(uuid, text) from public, anon;
revoke all on function public.record_mobile_test_parent_push_result(uuid, text, text) from public, anon;

grant execute on function public.register_mobile_test_parent_push_installation(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.get_mobile_test_parent_push_installation(uuid) to authenticated;
grant execute on function public.update_mobile_test_parent_push_preference(uuid, boolean, text) to authenticated;
grant execute on function public.unbind_mobile_test_parent_push_installation(uuid) to authenticated;
grant execute on function public.prepare_mobile_test_parent_push(uuid, text) to authenticated;
grant execute on function public.record_mobile_test_parent_push_result(uuid, text, text) to authenticated;

do $$
declare
  synthetic_parent_id uuid;
  eligible_count integer;
begin
  select count(distinct u.id), min(u.id::text)::uuid
  into eligible_count, synthetic_parent_id
  from public.users u
  where u.role = 'parent_portal'
    and u.status = 'active'
    and exists (
      select 1
      from public.parent_player_links ppl
      where ppl.auth_user_id = u.id
        and ppl.status = 'active'
    );

  if eligible_count <> 1 then
    raise exception 'expected_exactly_one_synthetic_mobile_parent';
  end if;

  insert into public.mobile_test_parent_push_allowlist (auth_user_id, platform)
  values
    (synthetic_parent_id, 'android'),
    (synthetic_parent_id, 'ios')
  on conflict (auth_user_id, platform) do nothing;
end;
$$;
