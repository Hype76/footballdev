alter table public.teams
  add column if not exists notification_display_name text;

alter table public.teams
  drop constraint if exists teams_notification_display_name_length_check;

alter table public.teams
  add constraint teams_notification_display_name_length_check
  check (
    notification_display_name is null
    or char_length(btrim(notification_display_name)) between 1 and 40
  );

comment on column public.teams.notification_display_name is
  'Optional short Team label used only in outbound notification copy. The official Team name remains unchanged.';

create or replace function public.set_team_notification_display_name(
  team_id_value uuid,
  display_name_value text
)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  target_team public.teams%rowtype;
  normalized_display_name text := nullif(btrim(coalesce(display_name_value, '')), '');
  updated_team public.teams%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select profile.* into actor
  from public.users profile
  where profile.id = auth.uid()
  limit 1;

  select team.* into target_team
  from public.teams team
  where team.id = team_id_value
    and team.archived_at is null
  for update;

  if actor.id is null
    or target_team.id is null
    or not app_private.actor_can_manage_team_resource(
      actor.id,
      target_team.club_id,
      target_team.id,
      20
    ) then
    raise exception using errcode = '42501', message = 'Coach or manager access is required for this Team.';
  end if;

  if normalized_display_name is null or char_length(normalized_display_name) > 40 then
    raise exception using errcode = '22023', message = 'Notification Team name must be between 1 and 40 characters.';
  end if;

  update public.teams team
  set notification_display_name = normalized_display_name,
      updated_at = timezone('utc', now()),
      updated_by = actor.id,
      updated_by_name = coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
      updated_by_email = coalesce(actor.email, '')
  where team.id = target_team.id
  returning team.* into updated_team;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_team.club_id,
    actor.id,
    'team_notification_display_name_updated',
    'team',
    target_team.id,
    jsonb_build_object(
      'previousDisplayName', target_team.notification_display_name,
      'notificationDisplayName', normalized_display_name,
      'officialTeamName', target_team.name
    )
  );

  return updated_team;
end;
$$;

alter function public.set_team_notification_display_name(uuid, text) owner to postgres;
revoke all on function public.set_team_notification_display_name(uuid, text) from public, anon;
revoke all on function public.set_team_notification_display_name(uuid, text) from service_role;
grant execute on function public.set_team_notification_display_name(uuid, text) to authenticated;

comment on function public.set_team_notification_display_name(uuid, text) is
  'Updates only the notification-specific Team label for an authorised active Coach, manager, or Club Admin.';
