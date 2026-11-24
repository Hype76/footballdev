-- Direct Adult Player registrations use their own verified account, never a Parent link.
create function public.get_shootout_adult_player_notification_targets(
  match_day_id_value uuid, installation_id_value uuid default null
)
returns table(installation_id uuid, user_id uuid, adult_link_id uuid, club_id uuid,
  team_id uuid, expo_push_token text, detail_level text)
language sql stable security definer set search_path='' as $$
  select d.installation_id, d.user_id, d.adult_link_id, d.club_id,
    d.team_id, d.expo_push_token, d.detail_level
  from public.match_days m
  join public.adult_player_mobile_push_installations d
    on d.club_id=m.club_id and d.team_id=m.team_id
  cross join lateral app_private.adult_player_portal_context_for_user(d.user_id) actor
  where m.id=match_day_id_value and m.deleted_at is null and m.previous_hidden_at is null
    and m.parent_visible and m.status in ('penalties','full_time')
    and m.match_date >= current_date-365
    and d.enabled and d.expo_push_token is not null
    and (installation_id_value is null or d.installation_id=installation_id_value)
    and actor.user_id=d.user_id and actor.link_id=d.adult_link_id
    and actor.club_id=d.club_id and actor.team_id=d.team_id
    and public.can_use_plan_feature(m.club_id,'parentPortal')
    and public.can_use_plan_feature(m.club_id,'matchDay')
    and (
      m.parent_audience in ('all_club_parents','all_team_parents')
      or (m.parent_audience='involved_players' and (
        exists (select 1 from public.match_day_availability_requests req
          where req.match_day_id=m.id and req.club_id=m.club_id and req.player_id=actor.player_id and req.status<>'expired')
        or exists (select 1 from public.calendar_event_invites inv
          where inv.match_day_id=m.id and inv.club_id=m.club_id and inv.player_id=actor.player_id and inv.invite_status<>'cancelled')
        or exists (select 1 from public.match_day_player_squad_decisions decision
          where decision.match_day_id=m.id and decision.club_id=m.club_id and decision.team_id=m.team_id
            and decision.player_id=actor.player_id and (decision.status='selected' or decision.notified_at is not null))
      ))
    )
    and coalesce(auth.jwt()->>'role','')='service_role';
$$;
revoke all on function public.get_shootout_adult_player_notification_targets(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_shootout_adult_player_notification_targets(uuid,uuid) to service_role;
