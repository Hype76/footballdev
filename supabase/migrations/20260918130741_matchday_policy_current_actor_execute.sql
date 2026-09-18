-- Keep the actor-parameter admin helper private while allowing restrictive RLS
-- policies to check only the current signed-in actor.
create or replace function public.matchday_current_actor_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and public.platform_access_is_admin_v1(auth.uid())
$$;

revoke all on function public.matchday_current_actor_is_platform_admin() from public, anon;
grant execute on function public.matchday_current_actor_is_platform_admin() to authenticated, service_role;

do $policy_gates$
declare
  gate record;
begin
  for gate in
    select * from (values
      ('evaluations', 'assessments'),
      ('assessment_sessions', 'assessments'),
      ('form_fields', 'customDevelopmentFields'),
      ('match_days', 'fixtures'),
      ('match_day_events', 'matchDay'),
      ('match_day_scorer_interest', 'matchDay'),
      ('match_day_scorer_assignments', 'matchDay'),
      ('parent_player_links', 'parentPortal'),
      ('calendar_trial_event_invitations', 'trialPlayers'),
      ('resource_library_items', 'resourceLibrary'),
      ('resource_library_links', 'resourceLibrary'),
      ('resource_library_external_links', 'resourceLibrary'),
      ('resource_library_parent_notifications', 'resourceLibrary'),
      ('staff_chat_conversations', 'staffChat'),
      ('staff_chat_members', 'staffChat'),
      ('staff_chat_messages', 'staffChat'),
      ('staff_chat_mobile_notification_intents', 'staffChat'),
      ('parent_chat_rooms', 'parentChat'),
      ('parent_chat_memberships', 'parentChat'),
      ('parent_chat_messages', 'parentChat'),
      ('parent_chat_mobile_notification_intents', 'parentChat')
    ) as gates(table_name, capability_key)
  loop
    if pg_catalog.to_regclass('public.' || gate.table_name) is not null then
      execute pg_catalog.format(
        'drop policy if exists plan_capability_select_restrictive on public.%I',
        gate.table_name
      );
      execute pg_catalog.format(
        'create policy plan_capability_select_restrictive on public.%I as restrictive for select to authenticated using (public.matchday_current_actor_is_platform_admin() or public.can_use_plan_feature(club_id, %L))',
        gate.table_name,
        gate.capability_key
      );
    end if;
  end loop;

  if pg_catalog.to_regclass('public.players') is not null then
    execute 'drop policy if exists plan_capability_select_restrictive on public.players';
    execute $players_policy$
      create policy plan_capability_select_restrictive
      on public.players
      as restrictive
      for select
      to authenticated
      using (
        public.matchday_current_actor_is_platform_admin()
        or (
          public.can_use_plan_feature(club_id, 'players')
          and (
            pg_catalog.lower(pg_catalog.btrim(coalesce(section, ''))) <> 'trial'
            or public.can_use_plan_feature(club_id, 'trialPlayers')
          )
        )
      )
    $players_policy$;
  end if;

  if pg_catalog.to_regclass('public.calendar_events') is not null then
    execute 'drop policy if exists plan_capability_select_restrictive on public.calendar_events';
    execute $calendar_policy$
      create policy plan_capability_select_restrictive
      on public.calendar_events
      as restrictive
      for select
      to authenticated
      using (
        public.matchday_current_actor_is_platform_admin()
        or (
          public.can_use_plan_feature(club_id, 'teamCalendar')
          and public.can_use_plan_feature(
            club_id,
            case
              when team_id is null then 'clubWideEvents'
              when event_type = 'training' then 'trainingEvents'
              when event_type = 'match' then 'fixtures'
              else 'generalEvents'
            end
          )
          and (
            coalesce(recurrence_frequency, 'none') = 'none'
            or public.can_use_plan_feature(club_id, 'recurringEvents')
          )
        )
      )
    $calendar_policy$;
  end if;
end
$policy_gates$;

