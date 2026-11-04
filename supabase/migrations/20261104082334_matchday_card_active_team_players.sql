-- Cards may be recorded for an active team player even when the match squad is empty.
-- Goals retain the selected-squad rule and substitutions retain their existing rule.
create or replace function private.match_day_event_type_participants(match_id uuid, event_type text)
returns table(id uuid, player_name text, shirt_number text, team_id uuid)
language sql stable security definer set search_path = '' as $function$
  select * from private.match_day_substitution_participants(match_id)
  where event_type in ('substitution', 'yellow_card', 'red_card')
  union all
  select * from private.match_day_event_participants(match_id)
  where event_type is distinct from 'substitution'
    and event_type is distinct from 'yellow_card'
    and event_type is distinct from 'red_card';
$function$;
revoke all on function private.match_day_event_type_participants(uuid,text) from public, anon, authenticated;
