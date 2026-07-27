-- Deployment: apply this migration before releasing the matching web candidate.
-- Initial state: existing authorised content is treated as viewed, except existing
-- Chat unread markers, which remain authoritative.
-- Rollback: preserve view state and ship a forward repair migration.

create table if not exists public.parent_portal_view_states (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  parent_link_id uuid references public.parent_player_links (id) on delete cascade,
  player_id uuid references public.players (id) on delete cascade,
  scope_type text not null,
  category_key text not null,
  last_viewed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_portal_view_states_scope_check
    check (scope_type in ('child', 'parent_global')),
  constraint parent_portal_view_states_category_check
    check (category_key in ('calendar', 'invites', 'matches', 'results', 'resources', 'chat', 'polls')),
  constraint parent_portal_view_states_scope_identity_check check (
    (
      scope_type = 'child'
      and parent_link_id is not null
      and player_id is not null
      and category_key <> 'chat'
    )
    or (
      scope_type = 'parent_global'
      and parent_link_id is null
      and player_id is null
      and category_key = 'chat'
    )
  )
);

create unique index if not exists parent_portal_view_states_child_key
on public.parent_portal_view_states (auth_user_id, parent_link_id, category_key)
where scope_type = 'child';

create unique index if not exists parent_portal_view_states_global_key
on public.parent_portal_view_states (auth_user_id, category_key)
where scope_type = 'parent_global';

create index if not exists parent_portal_view_states_user_updated_idx
on public.parent_portal_view_states (auth_user_id, updated_at desc);

alter table public.parent_portal_view_states enable row level security;
alter table public.parent_portal_view_states force row level security;

revoke all privileges on table public.parent_portal_view_states from public, anon, authenticated;
grant select, insert, update, delete on table public.parent_portal_view_states to service_role;

do $$
declare
  baseline_at timestamptz := statement_timestamp();
begin
  insert into public.parent_portal_view_states (
    auth_user_id,
    parent_link_id,
    player_id,
    scope_type,
    category_key,
    last_viewed_at,
    created_at,
    updated_at
  )
  select
    parent_link.auth_user_id,
    parent_link.id,
    parent_link.player_id,
    'child',
    category.category_key,
    baseline_at,
    baseline_at,
    baseline_at
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  cross join (
    values
      ('calendar'::text),
      ('invites'::text),
      ('matches'::text),
      ('results'::text),
      ('resources'::text),
      ('polls'::text)
  ) category(category_key)
  where parent_link.auth_user_id is not null
    and parent_link.status = 'active'
  on conflict (auth_user_id, parent_link_id, category_key)
    where scope_type = 'child'
  do nothing;

  insert into public.parent_portal_view_states (
    auth_user_id,
    parent_link_id,
    player_id,
    scope_type,
    category_key,
    last_viewed_at,
    created_at,
    updated_at
  )
  select
    parent_user.auth_user_id,
    null,
    null,
    'parent_global',
    'chat',
    coalesce(
      min(coalesce(membership.last_read_at, '1970-01-01 00:00:00+00'::timestamptz)),
      baseline_at
    ),
    baseline_at,
    baseline_at
  from (
    select distinct parent_link.auth_user_id
    from public.parent_player_links parent_link
    join public.players player
      on player.id = parent_link.player_id
     and player.club_id = parent_link.club_id
     and coalesce(player.status, 'active') <> 'archived'
     and player.archived_at is null
    where parent_link.auth_user_id is not null
      and parent_link.status = 'active'
  ) parent_user
  left join public.parent_chat_memberships membership
    on membership.auth_user_id = parent_user.auth_user_id
   and membership.member_kind = 'parent'
   and membership.active is true
  group by parent_user.auth_user_id
  on conflict (auth_user_id, category_key)
    where scope_type = 'parent_global'
  do nothing;
end;
$$;

create or replace function public.parent_portal_latest_category_activity(
  parent_link_id_value uuid,
  category_key_value text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  latest_activity_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Parent authentication is required.';
  end if;

  select parent_link.*
  into target_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  case category_key_value
    when 'calendar' then
      select max(activity.activity_at)
      into latest_activity_at
      from (
        select greatest(match_day.created_at, match_day.updated_at) as activity_at
        from public.get_parent_portal_match_days(target_link.id) match_day

        union all

        select greatest(event.created_at, event.updated_at)
        from public.calendar_events event
        where event.club_id = target_link.club_id
          and event.cancelled_at is null
          and event.parent_visible is true
          and event.parent_audience in ('all_team_parents', 'all_club_parents')
          and (
            (
              event.parent_audience = 'all_team_parents'
              and event.team_id is not null
              and event.team_id = target_link.team_id
            )
            or event.parent_audience = 'all_club_parents'
          )
          and event.starts_at >= (timezone('utc', now()) - interval '1 day')

        union all

        select greatest(invite.created_at, invite.updated_at)
        from public.calendar_event_invites invite
        where invite.club_id = target_link.club_id
          and invite.team_id = target_link.team_id
          and invite.player_id = target_link.player_id
          and invite.invite_status <> 'cancelled'
          and invite.cancelled_at is null
      ) activity;

    when 'invites' then
      select max(greatest(invite.created_at, invite.updated_at))
      into latest_activity_at
      from public.calendar_event_invites invite
      where invite.club_id = target_link.club_id
        and invite.team_id = target_link.team_id
        and invite.player_id = target_link.player_id
        and invite.invite_status <> 'cancelled'
        and invite.cancelled_at is null;

    when 'matches' then
      select max(greatest(match_day.created_at, match_day.updated_at))
      into latest_activity_at
      from public.get_parent_portal_match_days(target_link.id) match_day
      where match_day.status <> 'full_time'
        and (
          match_day.match_date is null
          or match_day.match_date >= timezone('Europe/London', now())::date
        );

    when 'results' then
      select max(greatest(match_day.created_at, match_day.updated_at))
      into latest_activity_at
      from public.get_parent_portal_match_days(target_link.id) match_day
      where match_day.status = 'full_time'
        or (
          match_day.match_date is not null
          and match_day.match_date < timezone('Europe/London', now())::date
        );

    when 'resources' then
      select max(greatest(
        resource.assigned_at,
        coalesce(notification.created_at, resource.assigned_at)
      ))
      into latest_activity_at
      from public.get_parent_portal_player_resources(target_link.id) resource
      left join public.resource_library_parent_notifications notification
        on notification.link_id = resource.link_id
       and notification.parent_link_id = target_link.id;

    when 'polls' then
      select max(poll.created_at)
      into latest_activity_at
      from public.get_parent_portal_polls(target_link.id) poll;

    when 'chat' then
      perform public.parent_chat_ensure_rooms_for_current_user();

      select max(message.created_at)
      into latest_activity_at
      from public.parent_chat_memberships membership
      join public.parent_chat_messages message
        on message.room_id = membership.room_id
       and message.deleted_at is null
       and message.sender_id <> auth.uid()
      where membership.auth_user_id = auth.uid()
        and membership.member_kind = 'parent'
        and membership.active is true;

    else
      raise exception 'Parent Portal activity category is not supported.';
  end case;

  return latest_activity_at;
end;
$$;

revoke all on function public.parent_portal_latest_category_activity(uuid, text) from public, anon, authenticated;
grant execute on function public.parent_portal_latest_category_activity(uuid, text) to service_role;

create or replace function public.get_parent_portal_activity_state(
  parent_link_id_value uuid
)
returns table (
  category_key text,
  scope_type text,
  parent_link_id uuid,
  player_id uuid,
  latest_activity_at timestamptz,
  last_viewed_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  baseline_at timestamptz := statement_timestamp();
  chat_baseline_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Parent authentication is required.';
  end if;

  select parent_link.*
  into target_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  perform public.parent_chat_ensure_rooms_for_current_user();

  insert into public.parent_portal_view_states (
    auth_user_id,
    parent_link_id,
    player_id,
    scope_type,
    category_key,
    last_viewed_at,
    created_at,
    updated_at
  )
  select
    auth.uid(),
    target_link.id,
    target_link.player_id,
    'child',
    category.category_key,
    baseline_at,
    baseline_at,
    baseline_at
  from (
    values
      ('calendar'::text),
      ('invites'::text),
      ('matches'::text),
      ('results'::text),
      ('resources'::text),
      ('polls'::text)
  ) category(category_key)
  on conflict (auth_user_id, parent_link_id, category_key)
    where scope_type = 'child'
  do nothing;

  select coalesce(
    min(coalesce(membership.last_read_at, '1970-01-01 00:00:00+00'::timestamptz)),
    baseline_at
  )
  into chat_baseline_at
  from public.parent_chat_memberships membership
  where membership.auth_user_id = auth.uid()
    and membership.member_kind = 'parent'
    and membership.active is true;

  insert into public.parent_portal_view_states (
    auth_user_id,
    parent_link_id,
    player_id,
    scope_type,
    category_key,
    last_viewed_at,
    created_at,
    updated_at
  )
  values (
    auth.uid(),
    null,
    null,
    'parent_global',
    'chat',
    chat_baseline_at,
    baseline_at,
    baseline_at
  )
  on conflict (auth_user_id, category_key)
    where scope_type = 'parent_global'
  do nothing;

  return query
  with registry(category_key, scope_type) as (
    values
      ('calendar'::text, 'child'::text),
      ('invites'::text, 'child'::text),
      ('matches'::text, 'child'::text),
      ('results'::text, 'child'::text),
      ('resources'::text, 'child'::text),
      ('chat'::text, 'parent_global'::text),
      ('polls'::text, 'child'::text)
  ),
  resolved as (
    select
      registry.category_key,
      registry.scope_type,
      case when registry.scope_type = 'child' then target_link.id else null end as parent_link_id,
      case when registry.scope_type = 'child' then target_link.player_id else null end as player_id,
      public.parent_portal_latest_category_activity(
        target_link.id,
        registry.category_key
      ) as latest_activity_at
    from registry
  )
  select
    resolved.category_key,
    resolved.scope_type,
    resolved.parent_link_id,
    resolved.player_id,
    resolved.latest_activity_at,
    view_state.last_viewed_at,
    resolved.latest_activity_at is not null
      and resolved.latest_activity_at > view_state.last_viewed_at as is_new
  from resolved
  join public.parent_portal_view_states view_state
    on view_state.auth_user_id = auth.uid()
   and view_state.category_key = resolved.category_key
   and view_state.scope_type = resolved.scope_type
   and (
     (
       resolved.scope_type = 'child'
       and view_state.parent_link_id = target_link.id
     )
     or (
       resolved.scope_type = 'parent_global'
       and view_state.parent_link_id is null
     )
   )
  order by array_position(
    array['calendar', 'invites', 'matches', 'results', 'resources', 'chat', 'polls']::text[],
    resolved.category_key
  );
end;
$$;

revoke all on function public.get_parent_portal_activity_state(uuid) from public, anon;
grant execute on function public.get_parent_portal_activity_state(uuid) to authenticated;
grant execute on function public.get_parent_portal_activity_state(uuid) to service_role;

create or replace function public.mark_parent_portal_category_viewed(
  parent_link_id_value uuid,
  category_key_value text,
  observed_activity_at_value timestamptz
)
returns table (
  category_key text,
  scope_type text,
  parent_link_id uuid,
  player_id uuid,
  latest_activity_at timestamptz,
  last_viewed_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  target_scope_type text;
  authoritative_latest_activity_at timestamptz;
  bounded_viewed_at timestamptz;
  saved_view_state public.parent_portal_view_states%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Parent authentication is required.';
  end if;

  if category_key_value not in ('calendar', 'invites', 'matches', 'results', 'resources', 'chat', 'polls') then
    raise exception 'Parent Portal activity category is not supported.';
  end if;

  select parent_link.*
  into target_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  perform 1
  from public.get_parent_portal_activity_state(target_link.id)
  limit 1;

  authoritative_latest_activity_at := public.parent_portal_latest_category_activity(
    target_link.id,
    category_key_value
  );

  if authoritative_latest_activity_at is null then
    raise exception 'There is no current activity to mark as viewed.';
  end if;

  if observed_activity_at_value is null then
    raise exception 'A successfully loaded activity cursor is required.';
  end if;

  bounded_viewed_at := least(
    observed_activity_at_value,
    authoritative_latest_activity_at
  );
  target_scope_type := case
    when category_key_value = 'chat' then 'parent_global'
    else 'child'
  end;

  if target_scope_type = 'parent_global' then
    update public.parent_portal_view_states view_state
    set
      last_viewed_at = greatest(view_state.last_viewed_at, bounded_viewed_at),
      updated_at = statement_timestamp()
    where view_state.auth_user_id = auth.uid()
      and view_state.scope_type = 'parent_global'
      and view_state.category_key = category_key_value
      and view_state.parent_link_id is null
    returning view_state.*
    into saved_view_state;
  else
    update public.parent_portal_view_states view_state
    set
      last_viewed_at = greatest(view_state.last_viewed_at, bounded_viewed_at),
      updated_at = statement_timestamp()
    where view_state.auth_user_id = auth.uid()
      and view_state.scope_type = 'child'
      and view_state.category_key = category_key_value
      and view_state.parent_link_id = target_link.id
    returning view_state.*
    into saved_view_state;
  end if;

  if saved_view_state.id is null then
    raise exception 'Parent Portal viewed state could not be saved.';
  end if;

  return query
  select
    category_key_value,
    target_scope_type,
    saved_view_state.parent_link_id,
    saved_view_state.player_id,
    authoritative_latest_activity_at,
    saved_view_state.last_viewed_at,
    authoritative_latest_activity_at > saved_view_state.last_viewed_at;
end;
$$;

revoke all on function public.mark_parent_portal_category_viewed(uuid, text, timestamptz) from public, anon;
grant execute on function public.mark_parent_portal_category_viewed(uuid, text, timestamptz) to authenticated;
grant execute on function public.mark_parent_portal_category_viewed(uuid, text, timestamptz) to service_role;

comment on table public.parent_portal_view_states is
  'Server-synchronised Parent Portal category view state. Child categories are isolated by active Parent link and Chat uses explicit Parent-global scope.';

comment on function public.get_parent_portal_activity_state(uuid) is
  'Returns authorised Parent Portal activity and viewed state for the selected child without exposing another Parent, child, team or club.';

comment on function public.mark_parent_portal_category_viewed(uuid, text, timestamptz) is
  'Advances only the signed-in Parent view state through an activity cursor observed before a successful category load.';
