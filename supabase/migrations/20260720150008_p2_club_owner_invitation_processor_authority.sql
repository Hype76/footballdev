create extension if not exists pgcrypto;

alter table public.club_owner_invites
  add column if not exists token_digest text,
  add column if not exists accepted_user_id uuid references auth.users (id) on delete set null,
  add column if not exists revoked_at timestamptz,
  add column if not exists replaced_at timestamptz,
  add column if not exists replaced_by_invite_id uuid references public.club_owner_invites (id) on delete set null;

update public.club_owner_invites
set token_digest = encode(digest(invite_token, 'sha256'), 'hex')
where token_digest is null
  and invite_token is not null;

alter table public.club_owner_invites
  alter column token_digest set not null;

create unique index if not exists club_owner_invites_token_digest_key
on public.club_owner_invites (token_digest);

alter table public.club_owner_invites
  drop constraint if exists club_owner_invites_status_check;

alter table public.club_owner_invites
  add constraint club_owner_invites_status_check
  check (status in ('pending', 'accepted', 'cancelled', 'revoked', 'replaced'));

alter table public.club_owner_invites
  drop column if exists invite_token;

create unique index if not exists club_owner_invites_one_active_identity_key
on public.club_owner_invites (club_id, lower(invited_email))
where status = 'pending'
  and accepted_at is null
  and revoked_at is null
  and replaced_at is null;

revoke all on table public.club_owner_invites from anon, authenticated;
grant select on table public.club_owner_invites to authenticated;

drop policy if exists club_owner_invites_select_scoped on public.club_owner_invites;
drop policy if exists club_owner_invites_insert_platform_admin on public.club_owner_invites;
drop policy if exists club_owner_invites_update_platform_admin on public.club_owner_invites;
drop policy if exists club_owner_invites_delete_platform_admin on public.club_owner_invites;

create policy club_owner_invites_select_management
on public.club_owner_invites
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_owner_invites.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 90
  )
);

create or replace function public.create_club_owner_invite_v2(
  p_club_id uuid,
  p_invited_email text,
  p_billing_mode text,
  p_plan_key text,
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
  inserted_invite public.club_owner_invites%rowtype;
  replaced_invite_ids uuid[] := '{}'::uuid[];
begin
  if p_club_id is null
    or normalized_email = ''
    or p_token_digest !~ '^[0-9a-f]{64}$'
    or p_billing_mode not in ('paid', 'unpaid')
    or p_expires_at <= timezone('utc', now()) then
    raise exception using errcode = '22023', message = 'club_owner_invitation_not_permitted';
  end if;

  if not exists (
    select 1
    from public.clubs c
    where c.id = p_club_id
      and coalesce(c.status, 'active') = 'active'
  ) then
    raise exception using errcode = '22023', message = 'club_owner_invitation_not_permitted';
  end if;

  with replaced as (
    update public.club_owner_invites i
    set status = 'replaced',
        replaced_at = timezone('utc', now())
    where i.club_id = p_club_id
      and lower(i.invited_email) = normalized_email
      and i.status = 'pending'
      and i.accepted_at is null
      and i.revoked_at is null
      and i.replaced_at is null
    returning i.id
  )
  select coalesce(array_agg(replaced.id), '{}'::uuid[])
  into replaced_invite_ids
  from replaced;

  insert into public.club_owner_invites (
    club_id,
    invited_email,
    billing_mode,
    plan_key,
    token_digest,
    status,
    expires_at,
    created_by
  )
  values (
    p_club_id,
    normalized_email,
    p_billing_mode,
    p_plan_key,
    p_token_digest,
    'pending',
    p_expires_at,
    p_created_by
  )
  returning * into inserted_invite;

  update public.club_owner_invites i
  set replaced_by_invite_id = inserted_invite.id
  where i.id = any(replaced_invite_ids);

  return jsonb_build_object(
    'id', inserted_invite.id,
    'expiresAt', inserted_invite.expires_at
  );
end;
$$;

create or replace function public.accept_club_owner_invite_v2(
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
begin
  if p_token_digest !~ '^[0-9a-f]{64}$' or p_auth_user_id is null then
    raise exception using errcode = '42501', message = 'club_owner_invitation_not_permitted';
  end if;

  select i.*
  into invite
  from public.club_owner_invites i
  where i.token_digest = p_token_digest
  for update;

  if invite.id is null then
    raise exception using errcode = '42501', message = 'club_owner_invitation_not_permitted';
  end if;

  if invite.status = 'accepted'
    and invite.accepted_user_id = p_auth_user_id then
    return jsonb_build_object(
      'completed', true,
      'idempotent', true,
      'clubId', invite.club_id,
      'billingMode', invite.billing_mode
    );
  end if;

  if invite.status <> 'pending'
    or invite.accepted_at is not null
    or invite.revoked_at is not null
    or invite.replaced_at is not null
    or invite.expires_at <= timezone('utc', now()) then
    raise exception using errcode = '42501', message = 'club_owner_invitation_not_permitted';
  end if;

  select
    lower(btrim(coalesce(au.email, ''))),
    coalesce(
      nullif(btrim(au.raw_user_meta_data ->> 'username'), ''),
      nullif(btrim(au.raw_user_meta_data ->> 'name'), ''),
      split_part(lower(btrim(coalesce(au.email, ''))), '@', 1)
    )
  into auth_email, actor_name
  from auth.users au
  where au.id = p_auth_user_id
    and au.deleted_at is null
    and (au.banned_until is null or au.banned_until <= timezone('utc', now()));

  if auth_email is null or auth_email <> lower(invite.invited_email) then
    raise exception using errcode = '42501', message = 'club_owner_invitation_not_permitted';
  end if;

  if not exists (
    select 1
    from public.clubs c
    where c.id = invite.club_id
      and coalesce(c.status, 'active') = 'active'
  ) then
    raise exception using errcode = '42501', message = 'club_owner_invitation_not_permitted';
  end if;

  select *
  into existing_profile
  from public.users u
  where u.id = p_auth_user_id
  for update;

  if existing_profile.id is not null
    and (
      existing_profile.status <> 'active'
      or existing_profile.club_id is distinct from invite.club_id
    ) then
    raise exception using errcode = '42501', message = 'club_owner_invitation_not_permitted';
  end if;

  if exists (
    select 1
    from public.user_club_memberships m
    where m.auth_user_id = p_auth_user_id
      and m.club_id <> invite.club_id
  ) then
    raise exception using errcode = '42501', message = 'club_owner_invitation_not_permitted';
  end if;

  insert into public.users (
    id, email, username, name, display_name, role, role_label, role_rank,
    club_id, force_password_change, status
  )
  values (
    p_auth_user_id, auth_email, actor_name, actor_name, actor_name, 'admin',
    'Club Admin', 90, invite.club_id, false, 'active'
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
    p_auth_user_id, auth_email, actor_name, actor_name, 'admin', 'Club Admin', 90,
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

  update public.club_owner_invites i
  set accepted_at = timezone('utc', now()),
      accepted_email = auth_email,
      accepted_user_id = p_auth_user_id,
      status = 'accepted'
  where i.id = invite.id
    and i.status = 'pending'
    and i.accepted_at is null;

  if not found then
    raise exception using errcode = '40001', message = 'club_owner_invitation_not_permitted';
  end if;

  insert into public.audit_logs (
    club_id, actor_id, actor_name, actor_email, actor_role_label, actor_role_rank,
    action, entity_type, entity_id, metadata
  )
  values (
    invite.club_id, p_auth_user_id, actor_name, auth_email, 'Club Admin', 90,
    'club_owner_invite_accepted', 'club_owner_invite', invite.id,
    jsonb_build_object(
      'billingMode', invite.billing_mode,
      'planKey', invite.plan_key,
      'identityBound', true,
      'tokenStoredAsDigest', true
    )
  );

  return jsonb_build_object(
    'completed', true,
    'idempotent', false,
    'clubId', invite.club_id,
    'billingMode', invite.billing_mode
  );
end;
$$;

revoke all on function public.create_club_owner_invite_v2(uuid, text, text, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.accept_club_owner_invite_v2(text, uuid) from public, anon, authenticated;
grant execute on function public.create_club_owner_invite_v2(uuid, text, text, text, text, uuid, timestamptz) to service_role;
grant execute on function public.accept_club_owner_invite_v2(text, uuid) to service_role;

comment on function public.create_club_owner_invite_v2(uuid, text, text, text, text, uuid, timestamptz) is
  'Service-only club-owner invitation creation with digest storage and active-invitation replacement.';

comment on function public.accept_club_owner_invite_v2(text, uuid) is
  'Service-only, identity-bound, transactional and idempotent club-owner invitation acceptance.';
