create or replace function public.parent_chat_sync_squad_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision_record public.match_day_player_squad_decisions%rowtype;
  room_id_value uuid;
begin
  decision_record := case when tg_op = 'DELETE' then old else new end;
  -- Squad selection and its notifications do not require Parent Chat.
  -- Keep the chat mutation gate intact and skip only this optional sync.
  if public.can_use_plan_feature(decision_record.club_id, 'parentChat') is not true then
    return coalesce(new, old);
  end if;

  if tg_op <> 'DELETE' and new.status = 'selected' then
    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      match_day_id,
      room_type,
      title,
      status
    )
    select
      fixture.club_id,
      fixture.team_id,
      fixture.id,
      'match_squad',
      'Match Squad Chat',
      case
        when fixture.previous_hidden_at is not null then 'archived'
        when fixture.status in ('scheduled', 'scorer_request', 'live', 'half_time') then 'active'
        else 'closed'
      end
    from public.match_days fixture
    where fixture.id = new.match_day_id
      and fixture.club_id = new.club_id
      and fixture.team_id = new.team_id
    on conflict (club_id, team_id, match_day_id) where room_type = 'match_squad'
    do update set
      status = excluded.status,
      updated_at = timezone('utc', now())
    returning id into room_id_value;
  else
    select room.id into room_id_value
    from public.parent_chat_rooms room
    where room.room_type = 'match_squad'
      and room.club_id = decision_record.club_id
      and room.team_id = decision_record.team_id
      and room.match_day_id = decision_record.match_day_id;
  end if;

  if room_id_value is not null then
    perform public.parent_chat_reconcile_room(room_id_value);
  end if;

  return coalesce(new, old);
end;
$$;
