create function public.get_adult_player_link_status(actor_id uuid, target_player_id uuid)
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
    'invite_digest', encode(sha256(convert_to(invite.token::text, 'UTF8')), 'hex'));
end;
$$;
revoke all on function public.get_adult_player_link_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_adult_player_link_status(uuid, uuid) to service_role;
