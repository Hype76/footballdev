create extension if not exists pgcrypto;

alter table public.club_owner_invites
  add column if not exists delivery_status text not null default 'unsent',
  add column if not exists provider_message_id text,
  add column if not exists delivery_attempted_at timestamptz,
  add column if not exists delivery_error_code text,
  add column if not exists correlation_id uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid;

update public.club_owner_invites
set delivery_status = case
  when invite_sent_at is not null then 'provider_accepted'
  else 'unsent'
end
where delivery_status = 'unsent';

alter table public.club_owner_invites
  drop constraint if exists club_owner_invites_delivery_status_check;

alter table public.club_owner_invites
  add constraint club_owner_invites_delivery_status_check
  check (delivery_status in ('unsent', 'processing', 'provider_accepted', 'failed', 'cancelled', 'replaced'));

create unique index if not exists club_owner_invites_one_active_identity_key
on public.club_owner_invites (club_id, lower(invited_email))
where status = 'pending'
  and accepted_at is null
  and revoked_at is null
  and replaced_at is null;

alter table public.club_user_invites
  add column if not exists status text not null default 'pending',
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists replaced_at timestamptz,
  add column if not exists replaced_by_invite_id uuid references public.club_user_invites (id) on delete set null,
  add column if not exists delivery_status text not null default 'unsent',
  add column if not exists provider_message_id text,
  add column if not exists delivery_attempted_at timestamptz,
  add column if not exists delivery_error_code text,
  add column if not exists correlation_id uuid;

update public.club_user_invites
set status = case when accepted_at is not null then 'accepted' else 'pending' end,
    delivery_status = case when invite_sent_at is not null then 'provider_accepted' else 'unsent' end;

alter table public.club_user_invites
  drop constraint if exists club_user_invites_status_check;

alter table public.club_user_invites
  add constraint club_user_invites_status_check
  check (status in ('pending', 'accepted', 'cancelled', 'replaced'));

alter table public.club_user_invites
  drop constraint if exists club_user_invites_delivery_status_check;

alter table public.club_user_invites
  add constraint club_user_invites_delivery_status_check
  check (delivery_status in ('unsent', 'processing', 'provider_accepted', 'failed', 'cancelled', 'replaced'));

drop index if exists public.club_user_invites_club_id_email_key;

create unique index if not exists club_user_invites_one_active_identity_key
on public.club_user_invites (club_id, lower(email))
where status = 'pending' and accepted_at is null and cancelled_at is null and replaced_at is null;

create table if not exists public.club_user_invite_teams (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.club_user_invites (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (invite_id, team_id)
);

create table if not exists public.platform_access_assignment_history (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  target_user_id uuid not null references auth.users (id) on delete restrict,
  assignment_type text not null check (assignment_type in ('club_admin', 'team_admin')),
  team_id uuid references public.teams (id) on delete restrict,
  role_key text not null,
  role_label text not null,
  role_rank integer not null,
  state text not null default 'removed' check (state in ('removed', 'restored')),
  removed_by uuid not null references auth.users (id) on delete restrict,
  removed_at timestamptz not null default timezone('utc', now()),
  restored_by uuid references auth.users (id) on delete restrict,
  restored_at timestamptz,
  correlation_id uuid not null,
  previous_state jsonb not null default '{}'::jsonb
);

create unique index if not exists platform_access_one_removed_club_assignment_key
on public.platform_access_assignment_history (club_id, target_user_id, assignment_type)
where state = 'removed' and team_id is null;

create unique index if not exists platform_access_one_removed_team_assignment_key
on public.platform_access_assignment_history (club_id, target_user_id, assignment_type, team_id)
where state = 'removed' and team_id is not null;

revoke all on table public.club_user_invite_teams from public, anon, authenticated;
revoke all on table public.platform_access_assignment_history from public, anon, authenticated;
grant all on table public.club_user_invite_teams to service_role;
grant all on table public.platform_access_assignment_history to service_role;

alter table public.club_user_invite_teams enable row level security;
alter table public.platform_access_assignment_history enable row level security;

create or replace function public.enforce_club_user_invite_state_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.status <> 'pending'
    and (
      new.status is distinct from old.status
      or new.accepted_at is distinct from old.accepted_at
      or new.cancelled_at is distinct from old.cancelled_at
      or new.replaced_at is distinct from old.replaced_at
    ) then
    raise exception using errcode = '42501', message = 'invitation_state_is_final';
  end if;

  if old.accepted_at is null and new.accepted_at is not null then
    if old.status <> 'pending'
      or old.cancelled_at is not null
      or old.replaced_at is not null
      or (old.expires_at is not null and old.expires_at <= timezone('utc', now())) then
      raise exception using errcode = '42501', message = 'invitation_acceptance_not_permitted';
    end if;
    new.status := 'accepted';
  end if;

  if new.status = 'cancelled' and new.cancelled_at is null then
    raise exception using errcode = '23514', message = 'cancelled_invitation_requires_timestamp';
  end if;

  if new.status = 'replaced' and new.replaced_at is null then
    raise exception using errcode = '23514', message = 'replaced_invitation_requires_timestamp';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_club_user_invite_state_v1() from public, anon, authenticated;

drop trigger if exists enforce_club_user_invite_state_v1 on public.club_user_invites;
create trigger enforce_club_user_invite_state_v1
before update on public.club_user_invites
for each row execute function public.enforce_club_user_invite_state_v1();

create or replace function public.platform_access_is_admin_v1(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.users u
    join public.platform_admins pa on pa.id = u.id
    where u.id = p_actor_id
      and u.role = 'super_admin'
      and u.status = 'active'
      and pa.status = 'active'
  );
$$;

create or replace function public.platform_access_audit_v1(
  p_actor_id uuid,
  p_club_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_outcome text,
  p_correlation_id uuid,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.users%rowtype;
  inserted_id uuid;
begin
  select * into actor from public.users where id = p_actor_id;

  insert into public.audit_logs (
    club_id,
    actor_id,
    actor_name,
    actor_email,
    actor_role_label,
    actor_role_rank,
    action,
    entity_type,
    entity_id,
    metadata,
    event_category,
    severity,
    outcome,
    correlation_id,
    source
  )
  values (
    p_club_id,
    p_actor_id,
    coalesce(actor.display_name, actor.name, actor.username, 'Platform Admin'),
    actor.email,
    coalesce(actor.role_label, 'Super Admin'),
    coalesce(actor.role_rank, 100),
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb),
    'security',
    case when p_outcome = 'success' then 'info' else 'warning' end,
    p_outcome,
    p_correlation_id,
    'platform_club_access'
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

create or replace function public.platform_create_access_invite_v1(
  p_actor_id uuid,
  p_club_id uuid,
  p_email text,
  p_role_key text,
  p_team_ids uuid[],
  p_token_digest text,
  p_token_value text,
  p_source_invite_id uuid,
  p_expires_at timestamptz,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_role text := lower(btrim(coalesce(p_role_key, '')));
  club public.clubs%rowtype;
  owner_source public.club_owner_invites%rowtype;
  staff_source public.club_user_invites%rowtype;
  inserted_owner public.club_owner_invites%rowtype;
  inserted_staff public.club_user_invites%rowtype;
  invalid_team_count integer;
  existing_membership_count integer;
  active_invite_count integer;
  team_ids uuid[] := coalesce(p_team_ids, '{}'::uuid[]);
  source_state text;
begin
  if not public.platform_access_is_admin_v1(p_actor_id) then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  if p_club_id is null
    or normalized_email = ''
    or normalized_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    or normalized_role not in ('admin', 'head_manager')
    or p_expires_at <= timezone('utc', now())
    or p_correlation_id is null then
    perform public.platform_access_audit_v1(
      p_actor_id, p_club_id, 'platform_access_invitation_denied', 'club', p_club_id,
      'denied', coalesce(p_correlation_id, gen_random_uuid()),
      jsonb_build_object('role', normalized_role, 'denialCode', 'invalid_request')
    );
    return jsonb_build_object('allowed', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || normalized_email || ':' || normalized_role, 0));

  select * into club
  from public.clubs c
  where c.id = p_club_id and coalesce(c.status, 'active') = 'active'
  for update;

  if club.id is null then
    perform public.platform_access_audit_v1(
      p_actor_id, p_club_id, 'platform_access_invitation_denied', 'club', p_club_id,
      'denied', p_correlation_id, jsonb_build_object('role', normalized_role, 'denialCode', 'club_not_found')
    );
    return jsonb_build_object('allowed', false, 'code', 'club_not_found');
  end if;

  if normalized_role = 'head_manager' then
    if cardinality(team_ids) = 0 then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_invitation_denied', 'club', p_club_id,
        'denied', p_correlation_id, jsonb_build_object('role', normalized_role, 'denialCode', 'team_required')
      );
      return jsonb_build_object('allowed', false, 'code', 'team_required');
    end if;

    select count(*) into invalid_team_count
    from unnest(team_ids) requested(team_id)
    left join public.teams t on t.id = requested.team_id and t.club_id = p_club_id and t.status = 'active'
    where t.id is null;

    if invalid_team_count > 0 then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_cross_club_team_denied', 'club', p_club_id,
        'denied', p_correlation_id,
        jsonb_build_object('role', normalized_role, 'teamIds', to_jsonb(team_ids), 'denialCode', 'cross_club_team')
      );
      return jsonb_build_object('allowed', false, 'code', 'cross_club_team');
    end if;
  else
    team_ids := '{}'::uuid[];
  end if;

  select count(*) into existing_membership_count
  from public.user_club_memberships m
  where m.club_id = p_club_id
    and lower(m.email) = normalized_email
    and (
      (normalized_role = 'admin' and m.role_rank >= 90)
      or (normalized_role = 'head_manager' and m.role = 'head_manager')
    );

  if existing_membership_count > 0 then
    perform public.platform_access_audit_v1(
      p_actor_id, p_club_id, 'platform_access_duplicate_invitation_denied', 'club', p_club_id,
      'denied', p_correlation_id,
      jsonb_build_object('role', normalized_role, 'recipient', regexp_replace(normalized_email, '^(.{2}).*(@.*)$', '\1***\2'), 'denialCode', 'active_membership_exists')
    );
    return jsonb_build_object('allowed', false, 'code', 'active_membership_exists');
  end if;

  if p_source_invite_id is null then
    if normalized_role = 'admin' then
      select count(*) into active_invite_count
      from public.club_owner_invites i
      where i.club_id = p_club_id
        and lower(i.invited_email) = normalized_email
        and i.status = 'pending'
        and i.accepted_at is null
        and i.revoked_at is null
        and i.replaced_at is null;
    else
      select count(*) into active_invite_count
      from public.club_user_invites i
      where i.club_id = p_club_id
        and lower(i.email) = normalized_email
        and i.role_key = normalized_role
        and i.status = 'pending'
        and i.accepted_at is null
        and i.cancelled_at is null
        and i.replaced_at is null;
    end if;

    if active_invite_count > 0 then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_duplicate_invitation_denied', 'club', p_club_id,
        'denied', p_correlation_id,
        jsonb_build_object('role', normalized_role, 'recipient', regexp_replace(normalized_email, '^(.{2}).*(@.*)$', '\1***\2'), 'denialCode', 'pending_invitation_exists')
      );
      return jsonb_build_object('allowed', false, 'code', 'pending_invitation_exists');
    end if;
  elsif normalized_role = 'admin' then
    select * into owner_source
    from public.club_owner_invites i
    where i.id = p_source_invite_id
    for update;

    if owner_source.id is null
      or owner_source.club_id <> p_club_id
      or lower(owner_source.invited_email) <> normalized_email
      or owner_source.status <> 'pending'
      or owner_source.accepted_at is not null
      or owner_source.revoked_at is not null
      or owner_source.replaced_at is not null
      or owner_source.delivery_status = 'processing' then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_invitation_replacement_denied', 'club_owner_invite', p_source_invite_id,
        'denied', p_correlation_id, jsonb_build_object('role', normalized_role, 'denialCode', 'source_not_replaceable')
      );
      return jsonb_build_object('allowed', false, 'code', 'source_not_replaceable');
    end if;

    update public.club_owner_invites
    set status = 'replaced',
        replaced_at = timezone('utc', now()),
        delivery_status = 'replaced'
    where id = owner_source.id;
    source_state := owner_source.status;
  else
    select * into staff_source
    from public.club_user_invites i
    where i.id = p_source_invite_id
    for update;

    if staff_source.id is null
      or staff_source.club_id <> p_club_id
      or lower(staff_source.email) <> normalized_email
      or staff_source.role_key <> normalized_role
      or staff_source.status <> 'pending'
      or staff_source.accepted_at is not null
      or staff_source.cancelled_at is not null
      or staff_source.replaced_at is not null
      or staff_source.delivery_status = 'processing' then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_invitation_replacement_denied', 'club_user_invite', p_source_invite_id,
        'denied', p_correlation_id, jsonb_build_object('role', normalized_role, 'denialCode', 'source_not_replaceable')
      );
      return jsonb_build_object('allowed', false, 'code', 'source_not_replaceable');
    end if;

    update public.club_user_invites
    set status = 'replaced',
        replaced_at = timezone('utc', now()),
        delivery_status = 'replaced'
    where id = staff_source.id;
    source_state := staff_source.status;
  end if;

  if normalized_role = 'admin' then
    if p_token_digest !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'invalid_token_digest';
    end if;

    insert into public.club_owner_invites (
      club_id, invited_email, billing_mode, plan_key, token_digest, status,
      expires_at, created_by, correlation_id
    )
    values (
      p_club_id, normalized_email, 'unpaid', club.plan_key, p_token_digest, 'pending',
      p_expires_at, p_actor_id, p_correlation_id
    )
    returning * into inserted_owner;

    if owner_source.id is not null then
      update public.club_owner_invites
      set replaced_by_invite_id = inserted_owner.id
      where id = owner_source.id;
    end if;

    perform public.platform_access_audit_v1(
      p_actor_id, p_club_id,
      case when p_source_invite_id is null then 'platform_club_admin_invitation_created' else 'platform_club_admin_invitation_replaced' end,
      'club_owner_invite', inserted_owner.id, 'success', p_correlation_id,
      jsonb_build_object(
        'role', 'admin',
        'roleLabel', 'Club Admin',
        'recipient', regexp_replace(normalized_email, '^(.{2}).*(@.*)$', '\1***\2'),
        'sourceInviteId', p_source_invite_id,
        'previousState', source_state,
        'newState', 'pending',
        'expiresAt', inserted_owner.expires_at
      )
    );

    return jsonb_build_object(
      'allowed', true,
      'inviteId', inserted_owner.id,
      'expiresAt', inserted_owner.expires_at,
      'roleKey', 'admin',
      'roleLabel', 'Club Admin',
      'recipient', normalized_email,
      'clubName', club.name
    );
  end if;

  if p_token_value is null or p_token_value !~ '^[0-9a-fA-F-]{36}$' then
    raise exception using errcode = '22023', message = 'invalid_invitation_token';
  end if;

  insert into public.club_user_invites (
    club_id, email, role_key, role_label, role_rank, created_by, invite_token,
    team_id, expires_at, status, correlation_id
  )
  values (
    p_club_id, normalized_email, 'head_manager', 'Team Admin', 70, p_actor_id, p_token_value::uuid,
    team_ids[1], p_expires_at, 'pending', p_correlation_id
  )
  returning * into inserted_staff;

  insert into public.club_user_invite_teams (invite_id, team_id)
  select inserted_staff.id, requested.team_id
  from unnest(team_ids) requested(team_id)
  on conflict do nothing;

  if staff_source.id is not null then
    update public.club_user_invites
    set replaced_by_invite_id = inserted_staff.id
    where id = staff_source.id;
  end if;

  perform public.platform_access_audit_v1(
    p_actor_id, p_club_id,
    case when p_source_invite_id is null then 'platform_team_admin_invitation_created' else 'platform_team_admin_invitation_replaced' end,
    'club_user_invite', inserted_staff.id, 'success', p_correlation_id,
    jsonb_build_object(
      'role', 'head_manager',
      'roleLabel', 'Team Admin',
      'recipient', regexp_replace(normalized_email, '^(.{2}).*(@.*)$', '\1***\2'),
      'teamIds', to_jsonb(team_ids),
      'sourceInviteId', p_source_invite_id,
      'previousState', source_state,
      'newState', 'pending',
      'expiresAt', inserted_staff.expires_at
    )
  );

  return jsonb_build_object(
    'allowed', true,
    'inviteId', inserted_staff.id,
    'expiresAt', inserted_staff.expires_at,
    'roleKey', 'head_manager',
    'roleLabel', 'Team Admin',
    'recipient', normalized_email,
    'clubName', club.name,
    'teamIds', to_jsonb(team_ids)
  );
end;
$$;

create or replace function public.platform_claim_access_invite_delivery_v1(
  p_actor_id uuid,
  p_invite_id uuid,
  p_role_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_role text := lower(btrim(coalesce(p_role_key, '')));
  target_club_id uuid;
  updated_count integer;
begin
  if not public.platform_access_is_admin_v1(p_actor_id) then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  if normalized_role not in ('admin', 'head_manager') then
    raise exception using errcode = '22023', message = 'invalid_access_role';
  end if;

  if normalized_role = 'admin' then
    update public.club_owner_invites
    set delivery_status = 'processing',
        delivery_attempted_at = timezone('utc', now())
    where id = p_invite_id
      and status = 'pending'
      and correlation_id = p_correlation_id
      and delivery_status = 'unsent'
    returning club_id into target_club_id;
  else
    update public.club_user_invites
    set delivery_status = 'processing',
        delivery_attempted_at = timezone('utc', now())
    where id = p_invite_id
      and status = 'pending'
      and correlation_id = p_correlation_id
      and delivery_status = 'unsent'
    returning club_id into target_club_id;
  end if;

  get diagnostics updated_count = row_count;

  if updated_count <> 1 then
    raise exception using errcode = '40001', message = 'delivery_state_conflict';
  end if;

  perform public.platform_access_audit_v1(
    p_actor_id,
    target_club_id,
    'platform_access_invitation_delivery_started',
    case when normalized_role = 'admin' then 'club_owner_invite' else 'club_user_invite' end,
    p_invite_id,
    'success',
    p_correlation_id,
    jsonb_build_object('role', normalized_role, 'previousState', 'unsent', 'newState', 'processing')
  );

  return jsonb_build_object('claimed', true, 'deliveryStatus', 'processing');
end;
$$;

create or replace function public.platform_record_access_invite_delivery_v1(
  p_actor_id uuid,
  p_invite_id uuid,
  p_role_key text,
  p_provider_message_id text,
  p_delivery_status text,
  p_error_code text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_role text := lower(btrim(coalesce(p_role_key, '')));
  normalized_delivery text := lower(btrim(coalesce(p_delivery_status, '')));
  target_club_id uuid;
  updated_count integer;
begin
  if not public.platform_access_is_admin_v1(p_actor_id) then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  if normalized_role not in ('admin', 'head_manager') then
    raise exception using errcode = '22023', message = 'invalid_access_role';
  end if;

  if normalized_delivery not in ('provider_accepted', 'failed') then
    raise exception using errcode = '22023', message = 'invalid_delivery_status';
  end if;

  if normalized_delivery = 'provider_accepted'
    and btrim(coalesce(p_provider_message_id, '')) = '' then
    raise exception using errcode = '22023', message = 'provider_message_id_required';
  end if;

  if normalized_role = 'admin' then
    update public.club_owner_invites i
    set delivery_status = normalized_delivery,
        provider_message_id = nullif(btrim(coalesce(p_provider_message_id, '')), ''),
        invite_sent_at = case when normalized_delivery = 'provider_accepted' then timezone('utc', now()) else i.invite_sent_at end,
        delivery_attempted_at = timezone('utc', now()),
        delivery_error_code = nullif(btrim(coalesce(p_error_code, '')), '')
    where i.id = p_invite_id
      and i.status = 'pending'
      and i.correlation_id = p_correlation_id
      and i.delivery_status = 'processing'
    returning i.club_id into target_club_id;
  else
    update public.club_user_invites i
    set delivery_status = normalized_delivery,
        provider_message_id = nullif(btrim(coalesce(p_provider_message_id, '')), ''),
        invite_sent_at = case when normalized_delivery = 'provider_accepted' then timezone('utc', now()) else i.invite_sent_at end,
        delivery_attempted_at = timezone('utc', now()),
        delivery_error_code = nullif(btrim(coalesce(p_error_code, '')), '')
    where i.id = p_invite_id
      and i.status = 'pending'
      and i.correlation_id = p_correlation_id
      and i.delivery_status = 'processing'
    returning i.club_id into target_club_id;
  end if;

  get diagnostics updated_count = row_count;

  if updated_count <> 1 then
    raise exception using errcode = '40001', message = 'delivery_state_conflict';
  end if;

  perform public.platform_access_audit_v1(
    p_actor_id, target_club_id,
    case when normalized_delivery = 'provider_accepted' then 'platform_access_invitation_provider_accepted' else 'platform_access_invitation_delivery_failed' end,
    case when normalized_role = 'admin' then 'club_owner_invite' else 'club_user_invite' end,
    p_invite_id,
    case when normalized_delivery = 'provider_accepted' then 'success' else 'failure' end,
    p_correlation_id,
    jsonb_build_object(
      'role', normalized_role,
      'deliveryStatus', normalized_delivery,
      'providerMessageId', nullif(btrim(coalesce(p_provider_message_id, '')), ''),
      'errorCode', nullif(btrim(coalesce(p_error_code, '')), '')
    )
  );

  return jsonb_build_object('recorded', true, 'deliveryStatus', normalized_delivery);
end;
$$;

create or replace function public.platform_cancel_access_invite_v1(
  p_actor_id uuid,
  p_invite_id uuid,
  p_role_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_role text := lower(btrim(coalesce(p_role_key, '')));
  target_club_id uuid;
  updated_count integer;
begin
  if not public.platform_access_is_admin_v1(p_actor_id) then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  if normalized_role not in ('admin', 'head_manager') then
    raise exception using errcode = '22023', message = 'invalid_access_role';
  end if;

  if normalized_role = 'admin' then
    update public.club_owner_invites
    set status = 'cancelled',
        revoked_at = timezone('utc', now()),
        cancelled_at = timezone('utc', now()),
        cancelled_by = p_actor_id,
        delivery_status = 'cancelled'
    where id = p_invite_id
      and status = 'pending'
      and accepted_at is null
      and revoked_at is null
      and replaced_at is null
      and delivery_status <> 'processing'
    returning club_id into target_club_id;
  else
    update public.club_user_invites
    set status = 'cancelled',
        cancelled_at = timezone('utc', now()),
        cancelled_by = p_actor_id,
        delivery_status = 'cancelled'
    where id = p_invite_id
      and status = 'pending'
      and accepted_at is null
      and cancelled_at is null
      and replaced_at is null
      and delivery_status <> 'processing'
    returning club_id into target_club_id;
  end if;

  get diagnostics updated_count = row_count;

  if updated_count <> 1 then
    perform public.platform_access_audit_v1(
      p_actor_id, target_club_id, 'platform_access_invitation_cancel_denied',
      case when normalized_role = 'admin' then 'club_owner_invite' else 'club_user_invite' end,
      p_invite_id, 'denied', p_correlation_id,
      jsonb_build_object('role', normalized_role, 'denialCode', 'invitation_not_cancellable')
    );
    return jsonb_build_object('allowed', false, 'code', 'invitation_not_cancellable');
  end if;

  perform public.platform_access_audit_v1(
    p_actor_id, target_club_id, 'platform_access_invitation_cancelled',
    case when normalized_role = 'admin' then 'club_owner_invite' else 'club_user_invite' end,
    p_invite_id, 'success', p_correlation_id,
    jsonb_build_object('role', normalized_role, 'previousState', 'pending', 'newState', 'cancelled')
  );

  return jsonb_build_object('allowed', true, 'status', 'cancelled');
end;
$$;

create or replace function public.platform_record_access_denial_v1(
  p_actor_id uuid,
  p_club_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_denial_code text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.platform_access_is_admin_v1(p_actor_id) then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  perform public.platform_access_audit_v1(
    p_actor_id,
    p_club_id,
    p_action,
    'user',
    p_target_user_id,
    'denied',
    p_correlation_id,
    jsonb_build_object('denialCode', p_denial_code)
  );

  return jsonb_build_object('recorded', true, 'allowed', false, 'code', p_denial_code);
end;
$$;

create or replace function public.platform_assign_existing_access_v1(
  p_actor_id uuid,
  p_club_id uuid,
  p_target_user_id uuid,
  p_email text,
  p_role_key text,
  p_team_ids uuid[],
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_role text := lower(btrim(coalesce(p_role_key, '')));
  team_ids uuid[] := coalesce(p_team_ids, '{}'::uuid[]);
  auth_email text;
  profile public.users%rowtype;
  invalid_team_count integer;
  duplicate_count integer;
  missing_team_count integer;
begin
  if not public.platform_access_is_admin_v1(p_actor_id) then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  if normalized_role not in ('admin', 'head_manager') then
    perform public.platform_access_audit_v1(
      p_actor_id, p_club_id, 'platform_access_existing_user_assignment_denied', 'user', p_target_user_id,
      'denied', p_correlation_id, jsonb_build_object('role', normalized_role, 'denialCode', 'invalid_access_role')
    );
    return jsonb_build_object('allowed', false, 'code', 'invalid_access_role');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || p_target_user_id::text || ':' || normalized_role, 0));

  select lower(email) into auth_email from auth.users where id = p_target_user_id;
  select * into profile from public.users where id = p_target_user_id;

  if auth_email is null or auth_email <> normalized_email then
    perform public.platform_access_audit_v1(
      p_actor_id, p_club_id, 'platform_access_existing_user_assignment_denied', 'user', p_target_user_id,
      'denied', p_correlation_id, jsonb_build_object('role', normalized_role, 'denialCode', 'target_identity_mismatch')
    );
    return jsonb_build_object('allowed', false, 'code', 'target_identity_mismatch');
  end if;

  if normalized_role = 'head_manager' then
    if cardinality(team_ids) = 0 then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_existing_user_assignment_denied', 'user', p_target_user_id,
        'denied', p_correlation_id, jsonb_build_object('role', normalized_role, 'denialCode', 'team_required')
      );
      return jsonb_build_object('allowed', false, 'code', 'team_required');
    end if;

    select count(*) into invalid_team_count
    from unnest(team_ids) requested(team_id)
    left join public.teams t on t.id = requested.team_id and t.club_id = p_club_id and t.status = 'active'
    where t.id is null;

    if invalid_team_count > 0 then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_cross_club_team_denied', 'user', p_target_user_id,
        'denied', p_correlation_id,
        jsonb_build_object('role', normalized_role, 'teamIds', to_jsonb(team_ids), 'denialCode', 'cross_club_team')
      );
      return jsonb_build_object('allowed', false, 'code', 'cross_club_team');
    end if;
  else
    team_ids := '{}'::uuid[];
  end if;

  select count(*) into duplicate_count
  from public.user_club_memberships m
  where m.auth_user_id = p_target_user_id
    and m.club_id = p_club_id
    and normalized_role = 'admin'
    and m.role_rank >= 90;

  if normalized_role = 'head_manager' then
    select count(*) into missing_team_count
    from unnest(team_ids) requested(team_id)
    where not exists (
      select 1
      from public.team_staff staff
      where staff.team_id = requested.team_id
        and staff.user_id = p_target_user_id
    );
  end if;

  if duplicate_count > 0 or (normalized_role = 'head_manager' and missing_team_count = 0) then
    perform public.platform_access_audit_v1(
      p_actor_id, p_club_id, 'platform_access_duplicate_assignment_denied', 'user', p_target_user_id,
      'denied', p_correlation_id, jsonb_build_object('role', normalized_role, 'denialCode', 'assignment_exists')
    );
    return jsonb_build_object('allowed', false, 'code', 'assignment_exists');
  end if;

  insert into public.user_club_memberships (
    auth_user_id, email, username, name, role, role_label, role_rank, club_id, updated_at
  )
  values (
    p_target_user_id,
    normalized_email,
    coalesce(profile.username, split_part(normalized_email, '@', 1)),
    coalesce(profile.name, profile.display_name, split_part(normalized_email, '@', 1)),
    normalized_role,
    case when normalized_role = 'admin' then 'Club Admin' else 'Team Admin' end,
    case when normalized_role = 'admin' then 90 else 70 end,
    p_club_id,
    timezone('utc', now())
  )
  on conflict (auth_user_id, club_id) do update
  set role = excluded.role,
      role_label = excluded.role_label,
      role_rank = excluded.role_rank,
      updated_at = excluded.updated_at;

  if profile.id is null then
    insert into public.users (
      id, email, username, name, display_name, role, role_label, role_rank, club_id, status
    )
    values (
      p_target_user_id, normalized_email, split_part(normalized_email, '@', 1),
      split_part(normalized_email, '@', 1), split_part(normalized_email, '@', 1),
      normalized_role,
      case when normalized_role = 'admin' then 'Club Admin' else 'Team Admin' end,
      case when normalized_role = 'admin' then 90 else 70 end,
      p_club_id, 'active'
    );
  elsif profile.status <> 'active' then
    update public.users
    set status = 'active',
        suspended_at = null,
        role = normalized_role,
        role_label = case when normalized_role = 'admin' then 'Club Admin' else 'Team Admin' end,
        role_rank = case when normalized_role = 'admin' then 90 else 70 end,
        club_id = p_club_id
    where id = p_target_user_id;
  elsif profile.club_id = p_club_id then
    update public.users
    set role = normalized_role,
        role_label = case when normalized_role = 'admin' then 'Club Admin' else 'Team Admin' end,
        role_rank = case when normalized_role = 'admin' then 90 else 70 end
    where id = p_target_user_id;
  end if;

  if normalized_role = 'head_manager' then
    insert into public.team_staff (team_id, user_id)
    select requested.team_id, p_target_user_id
    from unnest(team_ids) requested(team_id)
    on conflict (team_id, user_id) do nothing;
  end if;

  perform public.platform_access_audit_v1(
    p_actor_id, p_club_id,
    case when normalized_role = 'admin' then 'platform_club_admin_added' else 'platform_team_admin_assigned' end,
    'user', p_target_user_id, 'success', p_correlation_id,
    jsonb_build_object(
      'role', normalized_role,
      'recipient', regexp_replace(normalized_email, '^(.{2}).*(@.*)$', '\1***\2'),
      'teamIds', to_jsonb(team_ids),
      'previousState', case when profile.id is null then 'auth_only' else 'existing_user' end,
      'newState', 'active'
    )
  );

  return jsonb_build_object('allowed', true, 'kind', 'assignment', 'roleKey', normalized_role, 'teamIds', to_jsonb(team_ids));
end;
$$;

create or replace function public.platform_change_access_assignment_v1(
  p_actor_id uuid,
  p_club_id uuid,
  p_target_user_id uuid,
  p_assignment_type text,
  p_team_id uuid,
  p_action text,
  p_history_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_type text := lower(btrim(coalesce(p_assignment_type, '')));
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  membership public.user_club_memberships%rowtype;
  assignment public.team_staff%rowtype;
  history public.platform_access_assignment_history%rowtype;
  next_membership public.user_club_memberships%rowtype;
  active_admin_count integer;
  inserted_history_id uuid;
begin
  if not public.platform_access_is_admin_v1(p_actor_id) then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || p_target_user_id::text || ':' || normalized_type || ':' || coalesce(p_team_id::text, ''), 0));

  if normalized_action = 'remove' and normalized_type = 'club_admin' then
    select * into membership
    from public.user_club_memberships
    where auth_user_id = p_target_user_id and club_id = p_club_id and role_rank >= 90
    for update;

    select count(*) into active_admin_count
    from public.user_club_memberships
    where club_id = p_club_id and role_rank >= 90;

    if membership.id is null or active_admin_count <= 1 then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_critical_removal_denied', 'user', p_target_user_id,
        'denied', p_correlation_id,
        jsonb_build_object('role', 'admin', 'activeAdministratorCount', active_admin_count, 'denialCode', 'final_administrator')
      );
      return jsonb_build_object('allowed', false, 'code', 'final_administrator');
    end if;

    insert into public.platform_access_assignment_history (
      club_id, target_user_id, assignment_type, role_key, role_label, role_rank,
      removed_by, correlation_id, previous_state
    )
    values (
      p_club_id, p_target_user_id, 'club_admin', membership.role, membership.role_label, membership.role_rank,
      p_actor_id, p_correlation_id, to_jsonb(membership)
    )
    returning id into inserted_history_id;

    delete from public.team_staff staff
    using public.teams team
    where staff.team_id = team.id
      and team.club_id = p_club_id
      and staff.user_id = p_target_user_id;

    delete from public.user_club_memberships
    where id = membership.id;

    select * into next_membership
    from public.user_club_memberships
    where auth_user_id = p_target_user_id
    order by updated_at desc
    limit 1;

    if next_membership.id is null then
      update public.users
      set status = 'suspended', suspended_at = timezone('utc', now())
      where id = p_target_user_id and club_id = p_club_id;
    else
      update public.users
      set status = 'active',
          suspended_at = null,
          club_id = next_membership.club_id,
          role = next_membership.role,
          role_label = next_membership.role_label,
          role_rank = next_membership.role_rank
      where id = p_target_user_id and club_id = p_club_id;
    end if;
  elsif normalized_action = 'remove' and normalized_type = 'team_admin' then
    select staff.* into assignment
    from public.team_staff staff
    join public.teams team on team.id = staff.team_id
    where staff.user_id = p_target_user_id
      and staff.team_id = p_team_id
      and team.club_id = p_club_id
    for update of staff;

    if assignment.id is null then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_assignment_remove_denied', 'user', p_target_user_id,
        'denied', p_correlation_id,
        jsonb_build_object('role', 'head_manager', 'teamId', p_team_id, 'denialCode', 'assignment_not_found')
      );
      return jsonb_build_object('allowed', false, 'code', 'assignment_not_found');
    end if;

    select * into membership
    from public.user_club_memberships
    where auth_user_id = p_target_user_id and club_id = p_club_id;

    insert into public.platform_access_assignment_history (
      club_id, target_user_id, assignment_type, team_id, role_key, role_label, role_rank,
      removed_by, correlation_id, previous_state
    )
    values (
      p_club_id, p_target_user_id, 'team_admin', p_team_id,
      coalesce(membership.role, 'head_manager'), coalesce(membership.role_label, 'Team Admin'), coalesce(membership.role_rank, 70),
      p_actor_id, p_correlation_id, to_jsonb(assignment)
    )
    returning id into inserted_history_id;

    delete from public.team_staff where id = assignment.id;
  elsif normalized_action = 'restore' then
    select * into history
    from public.platform_access_assignment_history
    where id = p_history_id
      and club_id = p_club_id
      and target_user_id = p_target_user_id
      and state = 'removed'
    for update;

    if history.id is null then
      perform public.platform_access_audit_v1(
        p_actor_id, p_club_id, 'platform_access_assignment_restore_denied', 'user', p_target_user_id,
        'denied', p_correlation_id, jsonb_build_object('denialCode', 'removed_assignment_not_found')
      );
      return jsonb_build_object('allowed', false, 'code', 'removed_assignment_not_found');
    end if;

    if history.assignment_type = 'club_admin' then
      insert into public.user_club_memberships (
        auth_user_id, email, username, name, role, role_label, role_rank, club_id, updated_at
      )
      select
        p_target_user_id,
        u.email,
        u.username,
        u.name,
        history.role_key,
        history.role_label,
        history.role_rank,
        p_club_id,
        timezone('utc', now())
      from public.users u
      where u.id = p_target_user_id
      on conflict (auth_user_id, club_id) do update
      set role = excluded.role,
          role_label = excluded.role_label,
          role_rank = excluded.role_rank,
          updated_at = excluded.updated_at;

      update public.users
      set status = 'active',
          suspended_at = null,
          club_id = p_club_id,
          role = history.role_key,
          role_label = history.role_label,
          role_rank = history.role_rank
      where id = p_target_user_id
        and status <> 'active';
    else
      if not exists (
        select 1 from public.teams t
        where t.id = history.team_id and t.club_id = p_club_id and t.status = 'active'
      ) then
        perform public.platform_access_audit_v1(
          p_actor_id, p_club_id, 'platform_access_assignment_restore_denied', 'user', p_target_user_id,
          'denied', p_correlation_id, jsonb_build_object('teamId', history.team_id, 'denialCode', 'team_not_available')
        );
        return jsonb_build_object('allowed', false, 'code', 'team_not_available');
      end if;

      insert into public.team_staff (team_id, user_id)
      values (history.team_id, p_target_user_id)
      on conflict (team_id, user_id) do nothing;
    end if;

    update public.platform_access_assignment_history
    set state = 'restored',
        restored_by = p_actor_id,
        restored_at = timezone('utc', now())
    where id = history.id;

    inserted_history_id := history.id;
    normalized_type := history.assignment_type;
    p_team_id := history.team_id;
  else
    perform public.platform_access_audit_v1(
      p_actor_id, p_club_id, 'platform_access_assignment_change_denied', 'user', p_target_user_id,
      'denied', p_correlation_id, jsonb_build_object('denialCode', 'invalid_assignment_action')
    );
    return jsonb_build_object('allowed', false, 'code', 'invalid_assignment_action');
  end if;

  perform public.platform_access_audit_v1(
    p_actor_id, p_club_id,
    case when normalized_action = 'restore' then 'platform_access_assignment_restored' else 'platform_access_assignment_removed' end,
    'user', p_target_user_id, 'success', p_correlation_id,
    jsonb_build_object(
      'assignmentType', normalized_type,
      'teamId', p_team_id,
      'previousState', case when normalized_action = 'restore' then 'removed' else 'active' end,
      'newState', case when normalized_action = 'restore' then 'active' else 'removed' end,
      'historyId', inserted_history_id
    )
  );

  return jsonb_build_object(
    'allowed', true,
    'state', case when normalized_action = 'restore' then 'active' else 'removed' end,
    'historyId', inserted_history_id
  );
end;
$$;

revoke all on function public.platform_access_is_admin_v1(uuid) from public, anon, authenticated;
revoke all on function public.platform_access_audit_v1(uuid, uuid, text, text, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.platform_create_access_invite_v1(uuid, uuid, text, text, uuid[], text, text, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.platform_claim_access_invite_delivery_v1(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.platform_record_access_invite_delivery_v1(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.platform_cancel_access_invite_v1(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.platform_record_access_denial_v1(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.platform_assign_existing_access_v1(uuid, uuid, uuid, text, text, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.platform_change_access_assignment_v1(uuid, uuid, uuid, text, uuid, text, uuid, uuid) from public, anon, authenticated;

grant execute on function public.platform_create_access_invite_v1(uuid, uuid, text, text, uuid[], text, text, uuid, timestamptz, uuid) to service_role;
grant execute on function public.platform_claim_access_invite_delivery_v1(uuid, uuid, text, uuid) to service_role;
grant execute on function public.platform_record_access_invite_delivery_v1(uuid, uuid, text, text, text, text, uuid) to service_role;
grant execute on function public.platform_cancel_access_invite_v1(uuid, uuid, text, uuid) to service_role;
grant execute on function public.platform_record_access_denial_v1(uuid, uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.platform_assign_existing_access_v1(uuid, uuid, uuid, text, text, uuid[], uuid) to service_role;
grant execute on function public.platform_change_access_assignment_v1(uuid, uuid, uuid, text, uuid, text, uuid, uuid) to service_role;

comment on table public.platform_access_assignment_history is
  'FP-V1-PLATFORM-CLUB-ACCESS-MANAGEMENT-24 reversible service-authorised role assignment history.';

comment on function public.platform_create_access_invite_v1(uuid, uuid, text, text, uuid[], text, text, uuid, timestamptz, uuid) is
  'Creates or atomically replaces one Platform Admin controlled existing-club access invitation.';
