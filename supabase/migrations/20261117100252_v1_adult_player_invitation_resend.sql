create or replace function public.get_adult_player_link_status(actor_id uuid, target_player_id uuid)
returns jsonb
language plpgsql stable security definer
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
  if exists (select 1 from public.parent_player_links where player_id = player_row.id and status = 'active') then
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
revoke all on function public.get_adult_player_link_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_adult_player_link_status(uuid, uuid) to service_role;

create function public.reserve_adult_player_setup_resend(
  actor_id uuid, target_player_id uuid, expected_team_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.players;
  saved app_private.adult_player_setup_invites;
  reserved jsonb;
begin
  select * into player_row from public.players where id = target_player_id for update;
  if player_row.id is null
    or (expected_team_id is not null and player_row.team_id is distinct from expected_team_id)
    or not coalesce(app_private.actor_can_manage_team_resource(actor_id, player_row.club_id, player_row.team_id, 20), false)
  then return jsonb_build_object('state', 'denied'); end if;

  select * into saved from app_private.adult_player_setup_invites where player_id = target_player_id for update;
  if saved.accepted_at is not null then
    return public.get_adult_player_link_status(actor_id, target_player_id) - 'invite_digest';
  end if;
  reserved := public.reserve_adult_player_setup_invite(actor_id, target_player_id);
  if reserved->>'state' <> 'sent' then return reserved; end if;
  if saved.sent_at > now() - interval '5 minutes' then
    return jsonb_build_object('state', 'recently_sent');
  end if;

  update app_private.adult_player_setup_invites
    set token = gen_random_uuid(), expires_at = now() + interval '7 days', sent_at = null
    where player_id = target_player_id
    returning * into saved;
  return jsonb_build_object('state', 'pending', 'email', saved.email, 'token', saved.token);
end;
$$;

create function public.list_adult_player_setup_resend_targets(actor_id uuid, target_team_id uuid)
returns jsonb
language plpgsql stable
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
    and not exists (select 1 from public.parent_player_links l where l.player_id = p.id and l.status = 'active');
  return jsonb_build_object('state', 'ready', 'player_ids', targets);
end;
$$;

revoke all on function public.reserve_adult_player_setup_resend(uuid, uuid, uuid),
  public.list_adult_player_setup_resend_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_adult_player_setup_resend(uuid, uuid, uuid),
  public.list_adult_player_setup_resend_targets(uuid, uuid) to service_role;
