create or replace function public.get_parent_live_match_cards(match_id_value uuid, parent_link_id_value uuid)
returns table(event_type text, team_side text, event_status text)
language sql stable security definer set search_path = '' as $$
  select event.event_type::text, event.team_side::text, event.event_status::text
  from public.match_day_events event
  where event.match_day_id = match_id_value
    and event.event_type in ('yellow_card', 'red_card')
    and event.event_status in ('active', 'corrected')
    and exists (
      select 1 from public.get_parent_portal_match_days(parent_link_id_value) visible
      where visible.id = match_id_value
    );
$$;
revoke all on function public.get_parent_live_match_cards(uuid, uuid) from public, anon;
grant execute on function public.get_parent_live_match_cards(uuid, uuid) to authenticated;
