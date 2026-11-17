-- Keep child access while linking a verified adult self-contact to the same login.
-- Parent links belonging to another account on the adult record still require review.

create or replace function public.reserve_adult_player_setup_invite(actor_id uuid, target_player_id uuid)
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

  if exists (
    select 1 from public.parent_player_links l
    left join auth.users u on u.id = l.auth_user_id
    where l.player_id = player_row.id and l.status = 'active'
      and (u.id is null or u.email_confirmed_at is null
        or lower(btrim(u.email)) is distinct from app_private.adult_player_setup_email(player_row))
  ) then
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

create or replace function public.redeem_adult_player_setup_invite(invite_token uuid, account_id uuid default null)
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

  if exists (
    select 1 from public.parent_player_links l
    left join auth.users u on u.id = l.auth_user_id
    where l.player_id = player_row.id and l.status = 'active'
      and (u.id is null or u.email_confirmed_at is null
        or lower(btrim(u.email)) is distinct from app_private.adult_player_setup_email(player_row))
  ) then
    return jsonb_build_object('state', 'parent_linked');
  end if;

  if account_id is null then
    return jsonb_build_object('state', 'pending', 'email', invite.email);
  end if;

  if exists (select 1 from public.users where id = account_id)
    or exists (select 1 from public.user_club_memberships where auth_user_id = account_id) then
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

create or replace function public.get_adult_player_link_status(actor_id uuid, target_player_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  player_row public.players;
  invite app_private.adult_player_setup_invites;
begin
  select * into player_row from public.players where id = target_player_id;
  if player_row.id is null or not coalesce(
    app_private.actor_can_manage_team_resource(actor_id, player_row.club_id, player_row.team_id, 20), false
  ) then return jsonb_build_object('state', 'denied'); end if;

  if exists (select 1 from public.adult_player_account_links
    where player_id = player_row.id and club_id = player_row.club_id
      and team_id = player_row.team_id and status = 'active') then
    return jsonb_build_object('state', 'linked');
  end if;
  if app_private.adult_player_setup_email(player_row) is null then
    return jsonb_build_object('state', 'ineligible');
  end if;
  if exists (
    select 1 from public.parent_player_links l
    left join auth.users u on u.id = l.auth_user_id
    where l.player_id = player_row.id and l.status = 'active'
      and (u.id is null or u.email_confirmed_at is null
        or lower(btrim(u.email)) is distinct from app_private.adult_player_setup_email(player_row))
  ) then
    return jsonb_build_object('state', 'parent_linked');
  end if;
  select * into invite from app_private.adult_player_setup_invites
    where player_id = player_row.id and team_id = player_row.team_id
      and email = app_private.adult_player_setup_email(player_row);
  if invite.player_id is null then return jsonb_build_object('state', 'not_invited'); end if;
  if invite.accepted_at is not null then return jsonb_build_object('state', 'previous_invite_used'); end if;
  if invite.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  if invite.sent_at is null then return jsonb_build_object('state', 'not_invited'); end if;
  return jsonb_build_object('state', 'awaiting_acceptance',
    'invite_digest', encode(sha256(convert_to(invite.token::text, 'UTF8')), 'hex'), 'sent_at', invite.sent_at);
end;
$$;

create or replace function public.list_adult_player_setup_resend_targets(actor_id uuid, target_team_id uuid)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  team_row public.teams;
  targets jsonb;
begin
  select * into team_row from public.teams where id = target_team_id;
  if team_row.id is null
    or not coalesce(app_private.actor_can_manage_team_resource(actor_id, team_row.club_id, team_row.id, 50), false)
  then return jsonb_build_object('state', 'denied'); end if;
  select coalesce(jsonb_agg(p.id order by p.id), '[]'::jsonb) into targets
  from public.players p
  left join app_private.adult_player_setup_invites i on i.player_id = p.id
  where p.team_id = team_row.id and p.club_id = team_row.club_id
    and p.contact_type = 'self' and p.archived_at is null
    and app_private.adult_player_setup_email(p) is not null
    and i.accepted_at is null
    and (i.sent_at is null or i.sent_at <= now() - interval '5 minutes')
    and not exists (select 1 from public.adult_player_account_links a where a.player_id = p.id and a.status = 'active')
    and not exists (
      select 1 from public.parent_player_links l left join auth.users u on u.id = l.auth_user_id
      where l.player_id = p.id and l.status = 'active'
        and (u.id is null or u.email_confirmed_at is null
          or lower(btrim(u.email)) is distinct from app_private.adult_player_setup_email(p))
    );
  return jsonb_build_object('state', 'ready', 'player_ids', targets);
end;
$$;

create or replace function public.enforce_adult_player_account_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.players%rowtype;
begin
  new.updated_at := timezone('utc', now());

  if new.status = 'revoked' then
    new.revoked_at := coalesce(new.revoked_at, timezone('utc', now()));
    return new;
  end if;

  select player.*
  into player_row
  from public.players player
  where player.id = new.player_id
  for share;

  if player_row.id is null then
    raise exception 'The adult-player link requires a valid player.';
  end if;

  if player_row.status <> 'active'
    or player_row.archived_at is not null
    or player_row.team_id is null then
    raise exception 'The adult-player link requires an active player with a team.';
  end if;

  if player_row.date_of_birth is null then
    raise exception 'The adult-player link requires a verified date of birth.';
  end if;

  if player_row.date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'The adult-player link cannot be created for a player under 18.';
  end if;

  if player_row.contact_type not in ('self', 'both') then
    raise exception 'The adult-player link requires a self-managed player contact type.';
  end if;

  if not exists (
    select 1
    from public.teams team
    where team.id = player_row.team_id
      and team.club_id = player_row.club_id
  ) then
    raise exception 'The player team is outside the player club.';
  end if;

  if new.club_id is not null and new.club_id <> player_row.club_id then
    raise exception 'The requested club does not match the player club.';
  end if;

  if new.team_id is not null and new.team_id <> player_row.team_id then
    raise exception 'The requested team does not match the player team.';
  end if;

  if exists (
    select 1
    from public.users profile
    where profile.id = new.user_id
  ) then
    raise exception 'This authenticated user already has a staff or platform profile.';
  end if;

  if exists (
    select 1
    from public.parent_player_links parent_link
    where parent_link.status = 'active'
      and parent_link.player_id = new.player_id
      and parent_link.auth_user_id is distinct from new.user_id
  ) then
    raise exception 'This player has active parent access belonging to another account.';
  end if;

  new.club_id := player_row.club_id;
  new.team_id := player_row.team_id;
  new.verified_at := coalesce(new.verified_at, timezone('utc', now()));
  new.revoked_at := null;
  new.revoked_by := null;
  return new;
end;
$$;
