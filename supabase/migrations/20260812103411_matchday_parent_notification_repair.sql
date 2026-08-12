create or replace function public.authorize_match_day_push_v2(
  actor_user_id_value uuid,
  match_day_id_value uuid,
  parent_link_id_value uuid,
  notification_type_value text,
  event_id_value uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  match_row public.match_days%rowtype;
  actor_user public.users%rowtype;
  event_row public.match_day_events%rowtype;
  normalized_type text := lower(trim(coalesce(notification_type_value, '')));
  target_parent_link_ids uuid[] := array[]::uuid[];
begin
  if normalized_type not in ('yellow_card', 'red_card') then
    return public.authorize_match_day_push(
      actor_user_id_value,
      match_day_id_value,
      parent_link_id_value,
      normalized_type,
      event_id_value
    );
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
    and deleted_at is null;

  if match_row.id is null
    or match_row.status in ('cancelled', 'postponed') then
    return jsonb_build_object('allowed', false, 'reason', 'closed_match');
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time')
    or event_id_value is null then
    return jsonb_build_object('allowed', false, 'reason', 'gameplay_state');
  end if;

  select * into actor_user
  from public.users
  where id = actor_user_id_value;

  if actor_user.id is null
    or actor_user.role = 'parent_portal'
    or actor_user.club_id <> match_row.club_id
    or coalesce(actor_user.role_rank, 0) < 20
    or not (
      actor_user.role = 'super_admin'
      or coalesce(actor_user.role_rank, 0) >= 50
      or exists (
        select 1
        from public.team_staff staff_scope
        where staff_scope.team_id = match_row.team_id
          and staff_scope.user_id = actor_user.id
      )
    ) then
    return jsonb_build_object('allowed', false, 'reason', 'actor_scope');
  end if;

  select * into event_row
  from public.match_day_events
  where id = event_id_value
    and match_day_id = match_row.id
    and event_type = normalized_type
    and coalesce(event_status, 'active') = 'active';

  if event_row.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'event_scope');
  end if;

  select coalesce(array_agg(distinct parent_link.id), array[]::uuid[])
  into target_parent_link_ids
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and player.team_id = parent_link.team_id
   and coalesce(player.status, 'active') <> 'archived'
  where parent_link.club_id = match_row.club_id
    and parent_link.team_id = match_row.team_id
    and parent_link.status = 'active'
    and parent_link.auth_user_id is not null;

  return jsonb_build_object(
    'allowed', true,
    'targetParentLinkIds', to_jsonb(target_parent_link_ids),
    'operationKey', concat('match-day:', match_row.id, ':', normalized_type, ':', event_row.id)
  );
end;
$$;

revoke all on function public.authorize_match_day_push_v2(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_match_day_push_v2(uuid, uuid, uuid, text, uuid) to service_role;

comment on function public.authorize_match_day_push_v2(uuid, uuid, uuid, text, uuid) is
  'Server-authoritative Match Day push permission including saved active yellow and red card events.';

create table if not exists public.parent_communication_preferences (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  communication_channel text not null default 'both'
    check (communication_channel in ('app', 'email', 'both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.parent_communication_preferences enable row level security;
alter table public.parent_communication_preferences force row level security;

revoke all on public.parent_communication_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.parent_communication_preferences to service_role;

comment on table public.parent_communication_preferences is
  'Account-wide Parent choice for app notifications, email, or both. Missing rows default to both.';
