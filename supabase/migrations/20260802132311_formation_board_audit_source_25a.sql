-- FP-V1-FORMATION-BOARD-FOUNDATION-25A
-- Keep Formation Board audit writes inside the existing production source registry.

create or replace function app_private.formation_board_record_audit(
  actor_id uuid,
  target_club_id uuid,
  target_team_id uuid,
  action_value text,
  target_entity_id uuid,
  metadata_value jsonb default '{}'::jsonb,
  outcome_value text default 'success'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.users%rowtype;
  audit_id uuid;
  team_rank integer := 0;
begin
  select * into actor from public.users where id = actor_id and status = 'active';
  if not found then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  team_rank := app_private.formation_board_team_role_rank(actor_id, target_team_id, target_club_id);
  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata,
    actor_name,
    actor_email,
    actor_role_label,
    actor_role_rank,
    event_category,
    severity,
    outcome,
    source
  ) values (
    target_club_id,
    actor_id,
    action_value,
    'formation_board',
    target_entity_id,
    coalesce(metadata_value, '{}'::jsonb) || jsonb_build_object('teamId', target_team_id),
    coalesce(actor.name, ''),
    actor.email,
    coalesce((select role_label from public.team_staff where team_id = target_team_id and user_id = actor_id limit 1), actor.role_label, actor.role),
    greatest(team_rank, case when actor.role = 'admin' then actor.role_rank else 0 end),
    'operational',
    case when outcome_value = 'denied' then 'warning' else 'info' end,
    outcome_value,
    'application'
  ) returning id into audit_id;

  return audit_id;
end;
$$;
