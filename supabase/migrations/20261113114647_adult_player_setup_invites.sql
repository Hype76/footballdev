create table app_private.adult_player_setup_invites (
  player_id uuid primary key references public.players(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  sent_at timestamptz,
  accepted_at timestamptz
);

alter table app_private.adult_player_setup_invites enable row level security;

create function app_private.adult_player_setup_email(player_row public.players)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when count(distinct lower(btrim(contact->>'email'))) = 1 then min(lower(btrim(contact->>'email')))
  end
  from jsonb_array_elements(case when jsonb_typeof(to_jsonb(player_row.parent_contacts)) = 'array'
    then to_jsonb(player_row.parent_contacts) else '[]'::jsonb end) contact
  where contact->>'type' = 'self'
    and btrim(contact->>'email') ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    and player_row.status = 'active'
    and player_row.archived_at is null
    and player_row.contact_type = 'self'
    and player_row.date_of_birth <= (current_date - interval '18 years')::date
    and exists (select 1 from public.teams t where t.id = player_row.team_id
      and t.club_id = player_row.club_id and t.status = 'active')
    and exists (select 1 from public.clubs c where c.id = player_row.club_id
      and coalesce(c.status, 'active') = 'active' and c.archived_at is null);
$$;

create function public.reserve_adult_player_setup_invite(actor_id uuid, target_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.players;
  invite app_private.adult_player_setup_invites;
  player_email text;
begin
  select * into player_row from public.players where id = target_player_id for update;
  if player_row.id is null or not coalesce(
    app_private.actor_can_manage_team_resource(actor_id, player_row.club_id, player_row.team_id, 20), false
  ) then
    return jsonb_build_object('state', 'denied');
  end if;

  if exists (select 1 from public.adult_player_account_links where player_id = player_row.id and status = 'active') then
    return jsonb_build_object('state', 'linked');
  end if;

  player_email := app_private.adult_player_setup_email(player_row);
  if player_email is null then
    return jsonb_build_object('state', 'ineligible');
  end if;

  if exists (select 1 from public.parent_player_links where player_id = player_row.id and status = 'active') then
    return jsonb_build_object('state', 'parent_linked');
  end if;

  insert into app_private.adult_player_setup_invites as existing (player_id, team_id, email)
  values (player_row.id, player_row.team_id, player_email)
  on conflict (player_id) do update set
    team_id = excluded.team_id, email = excluded.email, token = excluded.token,
    expires_at = excluded.expires_at, sent_at = null, accepted_at = null
  where existing.expires_at <= now() or existing.email <> excluded.email or existing.team_id <> excluded.team_id;

  select * into invite from app_private.adult_player_setup_invites where player_id = player_row.id;
  return jsonb_build_object('state', case when invite.sent_at is not null then 'sent' else 'pending' end,
    'email', invite.email, 'token', invite.token);
end;
$$;

create function public.confirm_adult_player_setup_email(invite_token uuid)
returns void
language sql
set search_path = ''
as $$
  update app_private.adult_player_setup_invites set sent_at = coalesce(sent_at, now()) where token = invite_token;
$$;

create function public.redeem_adult_player_setup_invite(invite_token uuid, account_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite app_private.adult_player_setup_invites;
  player_row public.players;
  invite_player_id uuid;
begin
  select player_id into invite_player_id from app_private.adult_player_setup_invites where token = invite_token;
  select * into player_row from public.players where id = invite_player_id for update;
  select * into invite from app_private.adult_player_setup_invites where token = invite_token for update;

  if invite.player_id is null or player_row.id is null or invite.team_id is distinct from player_row.team_id
    or invite.email is distinct from app_private.adult_player_setup_email(player_row) then
    return jsonb_build_object('state', 'invalid');
  end if;

  if account_id is not null and not exists (
    select 1 from auth.users u where u.id = account_id and lower(u.email) = invite.email
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
  ) then
    return jsonb_build_object('state', 'wrong_account');
  end if;

  if invite.accepted_at is not null then
    if account_id is not null and exists (select 1 from public.adult_player_account_links
      where user_id = account_id and player_id = player_row.id and status = 'active') then
      return jsonb_build_object('state', 'accepted');
    end if;
    return jsonb_build_object('state', 'invalid');
  end if;
  if invite.expires_at <= now() then
    return jsonb_build_object('state', 'invalid');
  end if;

  if exists (select 1 from public.parent_player_links where player_id = player_row.id and status = 'active') then
    return jsonb_build_object('state', 'parent_linked');
  end if;

  if account_id is null then
    return jsonb_build_object('state', 'pending', 'email', invite.email);
  end if;

  if exists (select 1 from public.users where id = account_id)
    or exists (select 1 from public.user_club_memberships where auth_user_id = account_id)
    or exists (select 1 from public.parent_player_links where auth_user_id = account_id and status = 'active') then
    return jsonb_build_object('state', 'account_conflict');
  end if;

  insert into public.adult_player_account_links (user_id, player_id, club_id, team_id, verified_at)
  values (account_id, player_row.id, player_row.club_id, player_row.team_id, now())
  on conflict do nothing;
  if not exists (select 1 from public.adult_player_account_links
    where user_id = account_id and player_id = player_row.id and status = 'active') then
    return jsonb_build_object('state', 'account_conflict');
  end if;
  update app_private.adult_player_setup_invites set accepted_at = now() where token = invite_token;
  return jsonb_build_object('state', 'accepted');
end;
$$;

create function app_private.invalidate_adult_player_setup_invite()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from app_private.adult_player_setup_invites
  where player_id = new.id and (team_id is distinct from new.team_id
    or email is distinct from app_private.adult_player_setup_email(new));
  return new;
end;
$$;

create trigger invalidate_adult_player_setup_invite
after update of team_id, status, archived_at, contact_type, date_of_birth, parent_contacts on public.players
for each row execute function app_private.invalidate_adult_player_setup_invite();

revoke all on app_private.adult_player_setup_invites from public, anon, authenticated;
grant usage on schema app_private to service_role;
grant select, insert, update on app_private.adult_player_setup_invites to service_role;
revoke all on function app_private.adult_player_setup_email(public.players),
  app_private.invalidate_adult_player_setup_invite(),
  public.reserve_adult_player_setup_invite(uuid, uuid), public.confirm_adult_player_setup_email(uuid),
  public.redeem_adult_player_setup_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.adult_player_setup_email(public.players),
  public.reserve_adult_player_setup_invite(uuid, uuid), public.confirm_adult_player_setup_email(uuid),
  public.redeem_adult_player_setup_invite(uuid, uuid) to service_role;
