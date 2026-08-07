-- FP-V1-WORKSPACE-SCOPE-ONBOARDING-MASTER-03
-- Keeps the existing tenant container and makes commercial scope, ownership,
-- invitations, upgrades and controlled team transfer server-authoritative.

create schema if not exists app_private;

create or replace function public.workspace_scope_for_plan_key(raw_plan_key text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case public.normalize_subscription_plan_key(raw_plan_key)
    when 'individual' then 'individual'
    when 'single_team' then 'team'
    when 'small_club' then 'club'
    when 'development_club' then 'club'
    when 'large_club' then 'club'
    when 'pilot' then 'club'
    else 'unknown'
  end
$$;

revoke all on function public.workspace_scope_for_plan_key(text) from public, anon;
grant execute on function public.workspace_scope_for_plan_key(text) to authenticated, service_role;

alter table public.clubs
  add column if not exists workspace_owner_user_id uuid references public.users (id) on delete set null;

create index if not exists clubs_workspace_owner_user_id_idx
  on public.clubs (workspace_owner_user_id)
  where workspace_owner_user_id is not null;

with ranked_owner as (
  select
    app_user.club_id,
    app_user.id,
    row_number() over (
      partition by app_user.club_id
      order by
        case when app_user.role = 'head_manager' then 0 else 1 end,
        app_user.role_rank desc,
        app_user.id
    ) as owner_order
  from public.users app_user
  join public.clubs club on club.id = app_user.club_id
  where app_user.status = 'active'
    and public.workspace_scope_for_plan_key(club.plan_key) in ('individual', 'team')
    and app_user.role in ('head_manager', 'admin')
)
update public.clubs club
set workspace_owner_user_id = ranked_owner.id
from ranked_owner
where ranked_owner.club_id = club.id
  and ranked_owner.owner_order = 1
  and club.workspace_owner_user_id is null;

insert into public.teams (club_id, name)
select club.id, club.name
from public.clubs club
where public.workspace_scope_for_plan_key(club.plan_key) in ('individual', 'team')
  and not exists (
    select 1 from public.teams team where team.club_id = club.id
  );

alter table public.club_owner_invites
  add column if not exists invite_scope text,
  add column if not exists team_id uuid references public.teams (id) on delete restrict,
  add column if not exists intended_role_key text,
  add column if not exists intended_role_label text,
  add column if not exists intended_role_rank integer;

update public.club_owner_invites invite
set invite_scope = public.workspace_scope_for_plan_key(invite.plan_key),
    intended_role_key = case public.workspace_scope_for_plan_key(invite.plan_key)
      when 'club' then 'admin'
      when 'team' then 'head_manager'
      when 'individual' then 'head_manager'
      else ''
    end,
    intended_role_label = case public.workspace_scope_for_plan_key(invite.plan_key)
      when 'club' then 'Club Admin'
      when 'team' then 'Team Admin'
      when 'individual' then 'Coach Owner'
      else 'Unknown'
    end,
    intended_role_rank = case public.workspace_scope_for_plan_key(invite.plan_key)
      when 'club' then 90
      when 'team' then 70
      when 'individual' then 70
      else 0
    end,
    team_id = case
      when public.workspace_scope_for_plan_key(invite.plan_key) in ('individual', 'team')
        then (
          select team.id
          from public.teams team
          where team.club_id = invite.club_id
          order by team.created_at, team.id
          limit 1
        )
      else null
    end;

alter table public.club_owner_invites
  alter column invite_scope set not null,
  alter column intended_role_key set not null,
  alter column intended_role_label set not null,
  alter column intended_role_rank set not null,
  alter column invite_scope set default 'club';

alter table public.club_owner_invites
  drop constraint if exists club_owner_invites_scope_check,
  add constraint club_owner_invites_scope_check
    check (invite_scope in ('individual', 'team', 'club')),
  drop constraint if exists club_owner_invites_target_check,
  add constraint club_owner_invites_target_check
    check (
      (invite_scope = 'club' and team_id is null)
      or (invite_scope in ('individual', 'team') and team_id is not null)
    ),
  drop constraint if exists club_owner_invites_intended_role_check,
  add constraint club_owner_invites_intended_role_check
    check (
      (invite_scope = 'club' and intended_role_key = 'admin' and intended_role_label = 'Club Admin' and intended_role_rank = 90)
      or (invite_scope = 'team' and intended_role_key = 'head_manager' and intended_role_label = 'Team Admin' and intended_role_rank = 70)
      or (invite_scope = 'individual' and intended_role_key = 'head_manager' and intended_role_label = 'Coach Owner' and intended_role_rank = 70)
    );

create index if not exists club_owner_invites_team_id_idx
  on public.club_owner_invites (team_id)
  where team_id is not null;

create or replace function public.create_workspace_owner_invite_v3(
  p_club_id uuid,
  p_team_id uuid,
  p_invited_email text,
  p_billing_mode text,
  p_token_digest text,
  p_created_by uuid,
  p_expires_at timestamptz default timezone('utc', now()) + interval '14 days'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_invited_email, '')));
  target_plan_key text;
  target_scope text;
  target_role_key text;
  target_role_label text;
  target_role_rank integer;
  inserted_invite public.club_owner_invites%rowtype;
  replaced_invite_ids uuid[] := '{}'::uuid[];
begin
  if p_club_id is null
    or normalized_email = ''
    or p_token_digest !~ '^[0-9a-f]{64}$'
    or p_billing_mode not in ('paid', 'unpaid')
    or p_expires_at <= timezone('utc', now()) then
    raise exception using errcode = '22023', message = 'workspace_owner_invitation_not_permitted';
  end if;

  select public.normalize_subscription_plan_key(club.plan_key)
  into target_plan_key
  from public.clubs club
  where club.id = p_club_id
    and coalesce(club.status, 'active') = 'active'
  for key share;

  target_scope := public.workspace_scope_for_plan_key(target_plan_key);

  if target_scope = 'unknown' then
    raise exception using errcode = '22023', message = 'workspace_owner_invitation_not_permitted';
  end if;

  if target_scope in ('individual', 'team') then
    if p_team_id is null or not exists (
      select 1
      from public.teams team
      where team.id = p_team_id
        and team.club_id = p_club_id
        and coalesce(team.status, 'active') = 'active'
    ) then
      raise exception using errcode = '22023', message = 'workspace_owner_invitation_not_permitted';
    end if;
  elsif p_team_id is not null then
    raise exception using errcode = '22023', message = 'workspace_owner_invitation_not_permitted';
  end if;

  target_role_key := case when target_scope = 'club' then 'admin' else 'head_manager' end;
  target_role_label := case target_scope
    when 'club' then 'Club Admin'
    when 'team' then 'Team Admin'
    else 'Coach Owner'
  end;
  target_role_rank := case when target_scope = 'club' then 90 else 70 end;

  with replaced as (
    update public.club_owner_invites invite
    set status = 'replaced',
        replaced_at = timezone('utc', now())
    where invite.club_id = p_club_id
      and lower(invite.invited_email) = normalized_email
      and invite.status = 'pending'
      and invite.accepted_at is null
      and invite.revoked_at is null
      and invite.replaced_at is null
    returning invite.id
  )
  select coalesce(array_agg(replaced.id), '{}'::uuid[])
  into replaced_invite_ids
  from replaced;

  insert into public.club_owner_invites (
    club_id, team_id, invited_email, billing_mode, plan_key, invite_scope,
    intended_role_key, intended_role_label, intended_role_rank,
    token_digest, status, expires_at, created_by
  )
  values (
    p_club_id, case when target_scope = 'club' then null else p_team_id end,
    normalized_email, p_billing_mode, target_plan_key, target_scope,
    target_role_key, target_role_label, target_role_rank,
    p_token_digest, 'pending', p_expires_at, p_created_by
  )
  returning * into inserted_invite;

  update public.club_owner_invites invite
  set replaced_by_invite_id = inserted_invite.id
  where invite.id = any(replaced_invite_ids);

  return jsonb_build_object(
    'id', inserted_invite.id,
    'expiresAt', inserted_invite.expires_at,
    'scope', inserted_invite.invite_scope,
    'teamId', inserted_invite.team_id,
    'roleKey', inserted_invite.intended_role_key,
    'roleLabel', inserted_invite.intended_role_label,
    'roleRank', inserted_invite.intended_role_rank,
    'planKey', inserted_invite.plan_key
  );
end;
$$;

create or replace function public.accept_workspace_owner_invite_v3(
  p_token_digest text,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  invite public.club_owner_invites%rowtype;
  auth_email text;
  actor_name text;
  existing_profile public.users%rowtype;
  current_plan_key text;
  current_scope text;
  expected_role_key text;
  expected_role_label text;
  expected_role_rank integer;
begin
  if p_token_digest !~ '^[0-9a-f]{64}$' or p_auth_user_id is null then
    raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
  end if;

  select candidate.*
  into invite
  from public.club_owner_invites candidate
  where candidate.token_digest = p_token_digest
  for update;

  if invite.id is null then
    raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
  end if;

  if invite.status = 'accepted' and invite.accepted_user_id = p_auth_user_id then
    return jsonb_build_object(
      'completed', true,
      'idempotent', true,
      'clubId', invite.club_id,
      'teamId', invite.team_id,
      'scope', invite.invite_scope,
      'roleLabel', invite.intended_role_label,
      'billingMode', invite.billing_mode
    );
  end if;

  if invite.status <> 'pending'
    or invite.accepted_at is not null
    or invite.revoked_at is not null
    or invite.replaced_at is not null
    or invite.expires_at <= timezone('utc', now()) then
    raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
  end if;

  select public.normalize_subscription_plan_key(club.plan_key)
  into current_plan_key
  from public.clubs club
  where club.id = invite.club_id
    and coalesce(club.status, 'active') = 'active'
  for update;

  current_scope := public.workspace_scope_for_plan_key(current_plan_key);
  expected_role_key := case when current_scope = 'club' then 'admin' else 'head_manager' end;
  expected_role_label := case current_scope
    when 'club' then 'Club Admin'
    when 'team' then 'Team Admin'
    when 'individual' then 'Coach Owner'
    else 'Unknown'
  end;
  expected_role_rank := case when current_scope = 'club' then 90 when current_scope in ('individual', 'team') then 70 else 0 end;

  if current_scope = 'unknown'
    or current_plan_key is distinct from public.normalize_subscription_plan_key(invite.plan_key)
    or current_scope is distinct from invite.invite_scope
    or expected_role_key is distinct from invite.intended_role_key
    or expected_role_label is distinct from invite.intended_role_label
    or expected_role_rank is distinct from invite.intended_role_rank then
    raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
  end if;

  if current_scope in ('individual', 'team') then
    if invite.team_id is null or not exists (
      select 1
      from public.teams team
      where team.id = invite.team_id
        and team.club_id = invite.club_id
        and coalesce(team.status, 'active') = 'active'
    ) then
      raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
    end if;
  elsif invite.team_id is not null then
    raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
  end if;

  select
    lower(btrim(coalesce(auth_user.email, ''))),
    coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'username'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
      split_part(lower(btrim(coalesce(auth_user.email, ''))), '@', 1)
    )
  into auth_email, actor_name
  from auth.users auth_user
  where auth_user.id = p_auth_user_id
    and auth_user.deleted_at is null
    and (auth_user.banned_until is null or auth_user.banned_until <= timezone('utc', now()));

  if auth_email is null or auth_email <> lower(invite.invited_email) then
    raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
  end if;

  select *
  into existing_profile
  from public.users app_user
  where app_user.id = p_auth_user_id
  for update;

  if existing_profile.id is not null
    and (existing_profile.status <> 'active' or existing_profile.club_id is distinct from invite.club_id) then
    raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
  end if;

  if exists (
    select 1
    from public.user_club_memberships membership
    where membership.auth_user_id = p_auth_user_id
      and membership.club_id <> invite.club_id
  ) then
    raise exception using errcode = '42501', message = 'workspace_owner_invitation_not_permitted';
  end if;

  insert into public.users (
    id, email, username, name, display_name, role, role_label, role_rank,
    club_id, force_password_change, status
  )
  values (
    p_auth_user_id, auth_email, actor_name, actor_name, actor_name,
    expected_role_key, expected_role_label, expected_role_rank,
    invite.club_id, false, 'active'
  )
  on conflict (id) do update
  set email = excluded.email,
      username = coalesce(nullif(public.users.username, ''), excluded.username),
      name = coalesce(nullif(public.users.name, ''), excluded.name),
      display_name = coalesce(nullif(public.users.display_name, ''), excluded.display_name),
      role = excluded.role,
      role_label = excluded.role_label,
      role_rank = excluded.role_rank,
      club_id = excluded.club_id,
      force_password_change = false,
      status = 'active';

  insert into public.user_club_memberships (
    auth_user_id, email, username, name, role, role_label, role_rank, club_id, updated_at
  )
  values (
    p_auth_user_id, auth_email, actor_name, actor_name,
    expected_role_key, expected_role_label, expected_role_rank,
    invite.club_id, timezone('utc', now())
  )
  on conflict (auth_user_id, club_id) do update
  set email = excluded.email,
      username = coalesce(nullif(public.user_club_memberships.username, ''), excluded.username),
      name = coalesce(nullif(public.user_club_memberships.name, ''), excluded.name),
      role = excluded.role,
      role_label = excluded.role_label,
      role_rank = excluded.role_rank,
      updated_at = excluded.updated_at;

  if current_scope in ('individual', 'team') then
    insert into public.team_staff (team_id, user_id, role_key, updated_by)
    values (invite.team_id, p_auth_user_id, 'head_manager', p_auth_user_id)
    on conflict (team_id, user_id) do update
    set role_key = excluded.role_key,
        updated_by = excluded.updated_by;
  end if;

  update public.clubs club
  set workspace_owner_user_id = p_auth_user_id
  where club.id = invite.club_id;

  update public.club_owner_invites candidate
  set accepted_at = timezone('utc', now()),
      accepted_email = auth_email,
      accepted_user_id = p_auth_user_id,
      status = 'accepted'
  where candidate.id = invite.id
    and candidate.status = 'pending'
    and candidate.accepted_at is null;

  if not found then
    raise exception using errcode = '40001', message = 'workspace_owner_invitation_not_permitted';
  end if;

  insert into public.audit_logs (
    club_id, actor_id, actor_name, actor_email, actor_role_label, actor_role_rank,
    action, entity_type, entity_id, metadata
  )
  values (
    invite.club_id, p_auth_user_id, actor_name, auth_email, expected_role_label,
    expected_role_rank, 'workspace_owner_invite_accepted', 'workspace_owner_invite',
    invite.id, jsonb_build_object(
      'billingMode', invite.billing_mode,
      'planKey', invite.plan_key,
      'scope', invite.invite_scope,
      'teamId', invite.team_id,
      'roleKey', expected_role_key,
      'identityBound', true,
      'serverAuthoritativeScope', true,
      'tokenStoredAsDigest', true
    )
  );

  return jsonb_build_object(
    'completed', true,
    'idempotent', false,
    'clubId', invite.club_id,
    'teamId', invite.team_id,
    'scope', invite.invite_scope,
    'roleLabel', expected_role_label,
    'billingMode', invite.billing_mode
  );
end;
$$;

revoke all on function public.create_workspace_owner_invite_v3(uuid, uuid, text, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.accept_workspace_owner_invite_v3(text, uuid) from public, anon, authenticated;
grant execute on function public.create_workspace_owner_invite_v3(uuid, uuid, text, text, text, uuid, timestamptz) to service_role;
grant execute on function public.accept_workspace_owner_invite_v3(text, uuid) to service_role;

create table if not exists public.workspace_team_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  source_club_id uuid not null references public.clubs (id) on delete restrict,
  destination_club_id uuid not null references public.clubs (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'completed', 'rejected', 'cancelled')),
  created_by uuid not null references public.users (id) on delete restrict,
  source_approved_by uuid references public.users (id) on delete set null,
  source_approved_at timestamptz,
  destination_approved_by uuid references public.users (id) on delete set null,
  destination_approved_at timestamptz,
  rejected_by uuid references public.users (id) on delete set null,
  rejected_at timestamptz,
  completed_by uuid references public.users (id) on delete set null,
  completed_at timestamptz,
  preservation_before jsonb not null default '{}'::jsonb,
  preservation_after jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint workspace_team_transfer_distinct_clubs_check
    check (source_club_id <> destination_club_id),
  constraint workspace_team_transfer_source_approval_check
    check ((source_approved_by is null) = (source_approved_at is null)),
  constraint workspace_team_transfer_destination_approval_check
    check ((destination_approved_by is null) = (destination_approved_at is null))
);

create unique index if not exists workspace_team_transfer_one_open_team_idx
  on public.workspace_team_transfer_requests (team_id)
  where status in ('pending', 'ready');

create index if not exists workspace_team_transfer_source_idx
  on public.workspace_team_transfer_requests (source_club_id, status, created_at desc);

create index if not exists workspace_team_transfer_destination_idx
  on public.workspace_team_transfer_requests (destination_club_id, status, created_at desc);

alter table public.workspace_team_transfer_requests enable row level security;
revoke all on table public.workspace_team_transfer_requests from anon, authenticated;
grant select, insert, update, delete on table public.workspace_team_transfer_requests to service_role;

create or replace function app_private.workspace_team_transfer_snapshot(
  target_team_id uuid,
  target_club_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  snapshot jsonb := jsonb_build_object(
    'teamId', target_team_id,
    'clubId', target_club_id,
    'directCounts', '{}'::jsonb,
    'indirectCounts', '{}'::jsonb
  );
  relation record;
  row_count bigint;
begin
  for relation in
    select column_info.table_name
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
    group by column_info.table_name
    having bool_or(column_info.column_name = 'team_id')
       and bool_or(column_info.column_name = 'club_id')
    order by column_info.table_name
  loop
    execute format(
      'select count(*) from public.%I where team_id = $1 and club_id = $2',
      relation.table_name
    ) into row_count using target_team_id, target_club_id;

    snapshot := jsonb_set(
      snapshot,
      array['directCounts', relation.table_name],
      to_jsonb(row_count),
      true
    );
  end loop;

  select count(*) into row_count
  from public.assessment_session_games child
  join public.assessment_sessions parent on parent.id = child.session_id
  where parent.team_id = target_team_id and child.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,assessment_session_games}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.development_parent_reports child
  join public.evaluations parent on parent.id = child.evaluation_id
  where parent.team_id = target_team_id and child.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,development_parent_reports}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.communication_logs child
  where child.club_id = target_club_id
    and (
      exists (select 1 from public.players player where player.id = child.player_id and player.team_id = target_team_id)
      or exists (select 1 from public.evaluations evaluation where evaluation.id = child.evaluation_id and evaluation.team_id = target_team_id)
    );
  snapshot := jsonb_set(snapshot, '{indirectCounts,communication_logs}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.player_staff_notes child
  where child.club_id = target_club_id
    and exists (select 1 from public.players player where player.id = child.player_id and player.team_id = target_team_id);
  snapshot := jsonb_set(snapshot, '{indirectCounts,player_staff_notes}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.parent_chat_messages child
  join public.parent_chat_rooms parent on parent.id = child.room_id
  where parent.team_id = target_team_id and child.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,parent_chat_messages}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.parent_chat_memberships child
  join public.parent_chat_rooms parent on parent.id = child.room_id
  where parent.team_id = target_team_id and child.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,parent_chat_memberships}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.parent_chat_membership_audit child
  join public.parent_chat_rooms parent on parent.id = child.room_id
  where parent.team_id = target_team_id and child.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,parent_chat_membership_audit}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.staff_chat_messages child
  join public.staff_chat_conversations parent on parent.id = child.conversation_id
  where parent.team_id = target_team_id and child.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,staff_chat_messages}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.staff_chat_members child
  join public.staff_chat_conversations parent on parent.id = child.conversation_id
  where parent.team_id = target_team_id and child.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,staff_chat_members}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.team_staff assignment
  where assignment.team_id = target_team_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,team_staff}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.users app_user
  where app_user.club_id = target_club_id
    and exists (
      select 1 from public.team_staff assignment
      where assignment.team_id = target_team_id and assignment.user_id = app_user.id
    );
  snapshot := jsonb_set(snapshot, '{indirectCounts,assigned_users}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.user_club_memberships membership
  where membership.club_id = target_club_id
    and exists (
      select 1 from public.team_staff assignment
      where assignment.team_id = target_team_id and assignment.user_id = membership.auth_user_id
    );
  snapshot := jsonb_set(snapshot, '{indirectCounts,assigned_user_memberships}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.guardians guardian
  where guardian.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,guardians}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.match_locations location
  where location.club_id = target_club_id;
  snapshot := jsonb_set(snapshot, '{indirectCounts,match_locations}', to_jsonb(row_count), true);

  select count(*) into row_count
  from public.player_staff_notes note
  where note.club_id = target_club_id
    and note.audio_path <> ''
    and exists (select 1 from public.players player where player.id = note.player_id and player.team_id = target_team_id);
  snapshot := jsonb_set(snapshot, '{indirectCounts,staff_voice_note_attachments}', to_jsonb(row_count), true);

  return snapshot;
end;
$$;

revoke all on function app_private.workspace_team_transfer_snapshot(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.manage_workspace_team_transfer(
  p_action text,
  p_actor_id uuid,
  p_request_id uuid default null,
  p_team_id uuid default null,
  p_destination_club_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  actor public.users%rowtype;
  request_row public.workspace_team_transfer_requests%rowtype;
  source_club public.clubs%rowtype;
  destination_club public.clubs%rowtype;
  target_team public.teams%rowtype;
  actor_is_platform_admin boolean := false;
  actor_is_source_team_admin boolean := false;
  actor_is_destination_club_admin boolean := false;
  before_snapshot jsonb;
  after_snapshot jsonb;
  relation record;
  assigned_user record;
  trigger_table text;
  trigger_tables text[] := array[]::text[];
begin
  select app_user.*
  into actor
  from public.users app_user
  where app_user.id = p_actor_id
    and app_user.status = 'active'
  for key share;

  actor_is_platform_admin := actor.id is not null
    and actor.role = 'super_admin'
    and exists (
      select 1
      from public.platform_admins platform_access
      where platform_access.id = actor.id
        and platform_access.status = 'active'
    );

  if actor.id is null then
    raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
  end if;

  if normalized_action = 'create' then
    if not actor_is_platform_admin or p_team_id is null or p_destination_club_id is null then
      raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
    end if;

    select team.* into target_team
    from public.teams team
    where team.id = p_team_id and coalesce(team.status, 'active') = 'active'
    for update;

    select club.* into source_club
    from public.clubs club where club.id = target_team.club_id for update;
    select club.* into destination_club
    from public.clubs club where club.id = p_destination_club_id for update;

    if target_team.id is null
      or source_club.id is null
      or destination_club.id is null
      or source_club.id = destination_club.id
      or source_club.status <> 'active'
      or destination_club.status <> 'active'
      or public.workspace_scope_for_plan_key(source_club.plan_key) <> 'team'
      or public.workspace_scope_for_plan_key(destination_club.plan_key) <> 'club'
      or not public.can_insert_team_for_plan(destination_club.id)
      or (select count(*) from public.teams team where team.club_id = source_club.id and coalesce(team.status, 'active') = 'active') <> 1
      or not exists (
        select 1
        from public.team_staff assignment
        join public.users team_admin on team_admin.id = assignment.user_id
        where assignment.team_id = target_team.id
          and assignment.role_key = 'head_manager'
          and assignment.role_rank >= 70
          and team_admin.club_id = source_club.id
          and team_admin.status = 'active'
      ) then
      raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
    end if;

    before_snapshot := app_private.workspace_team_transfer_snapshot(target_team.id, source_club.id);

    insert into public.workspace_team_transfer_requests (
      team_id, source_club_id, destination_club_id, status, created_by, preservation_before
    )
    values (
      target_team.id, source_club.id, destination_club.id, 'pending', actor.id, before_snapshot
    )
    returning * into request_row;

    insert into public.audit_logs (
      club_id, actor_id, actor_name, actor_email, actor_role_label, actor_role_rank,
      action, entity_type, entity_id, metadata
    ) values
      (
        source_club.id, actor.id, coalesce(actor.name, actor.email), actor.email,
        coalesce(actor.role_label, 'Platform Admin'), actor.role_rank,
        'workspace_team_transfer_requested', 'workspace_team_transfer', request_row.id,
        jsonb_build_object('teamId', target_team.id, 'destinationClubId', destination_club.id, 'requiresSourceConsent', true, 'requiresDestinationAuthority', true)
      ),
      (
        destination_club.id, actor.id, coalesce(actor.name, actor.email), actor.email,
        coalesce(actor.role_label, 'Platform Admin'), actor.role_rank,
        'workspace_team_transfer_requested', 'workspace_team_transfer', request_row.id,
        jsonb_build_object('teamId', target_team.id, 'sourceClubId', source_club.id, 'requiresSourceConsent', true, 'requiresDestinationAuthority', true)
      );

  else
    if p_request_id is null then
      raise exception using errcode = '22023', message = 'workspace_team_transfer_not_permitted';
    end if;

    select transfer.* into request_row
    from public.workspace_team_transfer_requests transfer
    where transfer.id = p_request_id
    for update;

    if request_row.id is null then
      raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
    end if;

    select team.* into target_team
    from public.teams team where team.id = request_row.team_id for update;
    select club.* into source_club
    from public.clubs club where club.id = request_row.source_club_id for update;
    select club.* into destination_club
    from public.clubs club where club.id = request_row.destination_club_id for update;

    actor_is_source_team_admin := actor.club_id = request_row.source_club_id
      and exists (
        select 1
        from public.team_staff assignment
        where assignment.team_id = request_row.team_id
          and assignment.user_id = actor.id
          and assignment.role_key = 'head_manager'
          and assignment.role_rank >= 70
      );
    actor_is_destination_club_admin := actor.club_id = request_row.destination_club_id
      and actor.role = 'admin'
      and actor.role_rank >= 90
      and public.workspace_scope_for_plan_key(destination_club.plan_key) = 'club';

    if normalized_action = 'view' then
      if not (actor_is_platform_admin or actor_is_source_team_admin or actor_is_destination_club_admin) then
        raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
      end if;

    elsif normalized_action = 'approve' then
      if request_row.status <> 'pending' then
        raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
      end if;

      if actor_is_source_team_admin then
        update public.workspace_team_transfer_requests transfer
        set source_approved_by = actor.id,
            source_approved_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
        where transfer.id = request_row.id;
      elsif actor_is_destination_club_admin then
        update public.workspace_team_transfer_requests transfer
        set destination_approved_by = actor.id,
            destination_approved_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
        where transfer.id = request_row.id;
      else
        raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
      end if;

      update public.workspace_team_transfer_requests transfer
      set status = case
            when transfer.source_approved_at is not null and transfer.destination_approved_at is not null then 'ready'
            else transfer.status
          end,
          updated_at = timezone('utc', now())
      where transfer.id = request_row.id
      returning * into request_row;

    elsif normalized_action = 'reject' then
      if request_row.status not in ('pending', 'ready')
        or not (actor_is_platform_admin or actor_is_source_team_admin or actor_is_destination_club_admin) then
        raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
      end if;

      update public.workspace_team_transfer_requests transfer
      set status = 'rejected',
          rejected_by = actor.id,
          rejected_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where transfer.id = request_row.id
      returning * into request_row;

    elsif normalized_action = 'complete' then
      if not actor_is_platform_admin
        or request_row.status <> 'ready'
        or request_row.source_approved_by is null
        or request_row.destination_approved_by is null
        or target_team.club_id <> source_club.id
        or public.workspace_scope_for_plan_key(source_club.plan_key) <> 'team'
        or public.workspace_scope_for_plan_key(destination_club.plan_key) <> 'club'
        or not public.can_insert_team_for_plan(destination_club.id)
        or (select count(*) from public.teams team where team.club_id = source_club.id and coalesce(team.status, 'active') = 'active') <> 1 then
        raise exception using errcode = '42501', message = 'workspace_team_transfer_not_permitted';
      end if;

      if source_club.stripe_subscription_id is not null
        and coalesce(source_club.plan_status, '') not in ('cancelled', 'canceled', 'inactive') then
        raise exception using errcode = '55000', message = 'workspace_team_transfer_source_billing_review_required';
      end if;

      if exists (
        select 1
        from public.users source_user
        where source_user.club_id = source_club.id
          and source_user.status = 'active'
          and not exists (
            select 1 from public.team_staff assignment
            where assignment.team_id = target_team.id and assignment.user_id = source_user.id
          )
      ) then
        raise exception using errcode = '55000', message = 'workspace_team_transfer_source_user_review_required';
      end if;

      if exists (
        select 1
        from public.club_owner_invites owner_invite
        where owner_invite.club_id = source_club.id
          and owner_invite.status = 'pending'
          and owner_invite.accepted_at is null
          and owner_invite.revoked_at is null
          and owner_invite.replaced_at is null
      ) then
        raise exception using errcode = '55000', message = 'workspace_team_transfer_pending_owner_invite_review_required';
      end if;

      before_snapshot := app_private.workspace_team_transfer_snapshot(target_team.id, source_club.id);

      select coalesce(array_agg(scope_table.table_name order by scope_table.table_name), array[]::text[])
      into trigger_tables
      from (
        select column_info.table_name
        from information_schema.columns column_info
        where column_info.table_schema = 'public'
        group by column_info.table_name
        having bool_or(column_info.column_name = 'team_id')
           and bool_or(column_info.column_name = 'club_id')
        union
        select unnest(array[
          'assessment_session_games',
          'communication_logs',
          'development_parent_reports',
          'guardians',
          'match_locations',
          'parent_chat_membership_audit',
          'parent_chat_memberships',
          'parent_chat_messages',
          'player_staff_notes',
          'staff_chat_members',
          'staff_chat_messages',
          'teams',
          'user_club_memberships',
          'users'
        ]::text[])
      ) scope_table;

      -- Customer history contains immutable snapshots and lifecycle-protected rows.
      -- Disable only user triggers, transactionally, while changing tenant scope.
      -- Foreign-key constraint triggers remain enabled and the final count snapshot
      -- rolls the entire transaction back if any Team-linked record is not preserved.
      foreach trigger_table in array trigger_tables loop
        execute format('alter table public.%I disable trigger user', trigger_table);
      end loop;

      update public.assessment_session_games child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and exists (select 1 from public.assessment_sessions parent where parent.id = child.session_id and parent.team_id = target_team.id);

      update public.development_parent_reports child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and exists (select 1 from public.evaluations parent where parent.id = child.evaluation_id and parent.team_id = target_team.id);

      update public.communication_logs child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and (
          exists (select 1 from public.players player where player.id = child.player_id and player.team_id = target_team.id)
          or exists (select 1 from public.evaluations evaluation where evaluation.id = child.evaluation_id and evaluation.team_id = target_team.id)
        );

      update public.player_staff_notes child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and exists (select 1 from public.players player where player.id = child.player_id and player.team_id = target_team.id);

      update public.parent_chat_membership_audit child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and exists (select 1 from public.parent_chat_rooms parent where parent.id = child.room_id and parent.team_id = target_team.id);

      update public.parent_chat_memberships child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and exists (select 1 from public.parent_chat_rooms parent where parent.id = child.room_id and parent.team_id = target_team.id);

      update public.parent_chat_messages child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and exists (select 1 from public.parent_chat_rooms parent where parent.id = child.room_id and parent.team_id = target_team.id);

      update public.staff_chat_members child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and exists (select 1 from public.staff_chat_conversations parent where parent.id = child.conversation_id and parent.team_id = target_team.id);

      update public.staff_chat_messages child
      set club_id = destination_club.id
      where child.club_id = source_club.id
        and exists (select 1 from public.staff_chat_conversations parent where parent.id = child.conversation_id and parent.team_id = target_team.id);

      update public.guardians guardian
      set club_id = destination_club.id
      where guardian.club_id = source_club.id;

      update public.match_locations location
      set club_id = destination_club.id
      where location.club_id = source_club.id;

      for assigned_user in
        select app_user.*
        from public.team_staff assignment
        join public.users app_user on app_user.id = assignment.user_id
        where assignment.team_id = target_team.id
        for update of app_user
      loop
        insert into public.user_club_memberships (
          auth_user_id, email, username, name, role, role_label, role_rank, club_id, updated_at
        ) values (
          assigned_user.id, assigned_user.email, assigned_user.username, assigned_user.name,
          assigned_user.role, assigned_user.role_label, assigned_user.role_rank,
          destination_club.id, timezone('utc', now())
        )
        on conflict (auth_user_id, club_id) do update
        set email = excluded.email,
            username = excluded.username,
            name = excluded.name,
            updated_at = excluded.updated_at;

        delete from public.user_club_memberships membership
        where membership.auth_user_id = assigned_user.id
          and membership.club_id = source_club.id;

        update public.users app_user
        set club_id = destination_club.id
        where app_user.id = assigned_user.id;
      end loop;

      update public.teams team
      set club_id = destination_club.id,
          updated_at = timezone('utc', now()),
          updated_by = actor.id,
          updated_by_email = actor.email,
          updated_by_name = coalesce(actor.name, actor.email)
      where team.id = target_team.id
        and team.club_id = source_club.id;

      for relation in
        select column_info.table_name
        from information_schema.columns column_info
        where column_info.table_schema = 'public'
        group by column_info.table_name
        having bool_or(column_info.column_name = 'team_id')
           and bool_or(column_info.column_name = 'club_id')
        order by column_info.table_name
      loop
        execute format(
          'update public.%I set club_id = $1 where team_id = $2 and club_id = $3',
          relation.table_name
        ) using destination_club.id, target_team.id, source_club.id;
      end loop;

      update public.clubs club
      set status = 'suspended',
          suspended_at = timezone('utc', now()),
          workspace_owner_user_id = null,
          plan_status = 'cancelled',
          is_plan_comped = false,
          plan_updated_at = timezone('utc', now())
      where club.id = source_club.id;

      foreach trigger_table in array trigger_tables loop
        execute format('alter table public.%I enable trigger user', trigger_table);
      end loop;

      after_snapshot := app_private.workspace_team_transfer_snapshot(target_team.id, destination_club.id);

      if before_snapshot -> 'directCounts' is distinct from after_snapshot -> 'directCounts'
        or before_snapshot -> 'indirectCounts' is distinct from after_snapshot -> 'indirectCounts'
        or before_snapshot ->> 'teamId' is distinct from after_snapshot ->> 'teamId' then
        raise exception using errcode = '40001', message = 'workspace_team_transfer_preservation_check_failed';
      end if;

      update public.workspace_team_transfer_requests transfer
      set status = 'completed',
          completed_by = actor.id,
          completed_at = timezone('utc', now()),
          preservation_before = before_snapshot,
          preservation_after = after_snapshot,
          updated_at = timezone('utc', now())
      where transfer.id = request_row.id
      returning * into request_row;

      insert into public.audit_logs (
        club_id, actor_id, actor_name, actor_email, actor_role_label, actor_role_rank,
        action, entity_type, entity_id, metadata
      ) values
        (
          source_club.id, actor.id, coalesce(actor.name, actor.email), actor.email,
          coalesce(actor.role_label, 'Platform Admin'), actor.role_rank,
          'workspace_team_transfer_completed', 'workspace_team_transfer', request_row.id,
          jsonb_build_object('teamId', target_team.id, 'destinationClubId', destination_club.id, 'sourceApprovedBy', request_row.source_approved_by, 'destinationApprovedBy', request_row.destination_approved_by, 'preservation', after_snapshot)
        ),
        (
          destination_club.id, actor.id, coalesce(actor.name, actor.email), actor.email,
          coalesce(actor.role_label, 'Platform Admin'), actor.role_rank,
          'workspace_team_transfer_completed', 'workspace_team_transfer', request_row.id,
          jsonb_build_object('teamId', target_team.id, 'sourceClubId', source_club.id, 'sourceApprovedBy', request_row.source_approved_by, 'destinationApprovedBy', request_row.destination_approved_by, 'preservation', after_snapshot)
        );
    else
      raise exception using errcode = '22023', message = 'workspace_team_transfer_not_permitted';
    end if;
  end if;

  select transfer.* into request_row
  from public.workspace_team_transfer_requests transfer
  where transfer.id = request_row.id;

  return jsonb_build_object(
    'id', request_row.id,
    'teamId', request_row.team_id,
    'sourceClubId', request_row.source_club_id,
    'destinationClubId', request_row.destination_club_id,
    'status', request_row.status,
    'sourceApproved', request_row.source_approved_at is not null,
    'destinationApproved', request_row.destination_approved_at is not null,
    'completed', request_row.completed_at is not null,
    'preservationBefore', request_row.preservation_before,
    'preservationAfter', request_row.preservation_after
  );
end;
$$;

revoke all on function public.manage_workspace_team_transfer(text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.manage_workspace_team_transfer(text, uuid, uuid, uuid, uuid) to service_role;

drop policy if exists staff_voice_notes_select_scoped on storage.objects;
create policy staff_voice_notes_select_scoped
on storage.objects
for select
to authenticated
using (
  bucket_id = 'staff-voice-notes'
  and public.current_user_role_rank() >= 20
  and exists (
    select 1
    from public.player_staff_notes note
    where note.audio_path = name
      and note.club_id = public.current_user_club_id()
  )
);

comment on function public.workspace_scope_for_plan_key(text) is
  'Canonical V1 commercial workspace scope resolver. Unknown plan keys fail closed.';
comment on function public.create_workspace_owner_invite_v3(uuid, uuid, text, text, text, uuid, timestamptz) is
  'Service-only workspace owner invite creation with server-derived scope, role and team target.';
comment on function public.accept_workspace_owner_invite_v3(text, uuid) is
  'Service-only transactional invite acceptance with identity binding and server-authoritative scope.';
comment on function public.manage_workspace_team_transfer(text, uuid, uuid, uuid, uuid) is
  'Service-only controlled team transfer requiring source Team Admin consent, destination Club Admin authority and Platform Admin completion.';
