begin;

create or replace function public.platform_access_audit_v1(
  p_actor_id uuid,
  p_club_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_outcome text,
  p_correlation_id uuid,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.users%rowtype;
  inserted_id uuid;
begin
  select * into actor from public.users where id = p_actor_id;

  insert into public.audit_logs (
    club_id,
    actor_id,
    actor_name,
    actor_email,
    actor_role_label,
    actor_role_rank,
    action,
    entity_type,
    entity_id,
    metadata,
    event_category,
    severity,
    outcome,
    correlation_id,
    source
  )
  values (
    p_club_id,
    p_actor_id,
    coalesce(actor.display_name, actor.name, actor.username, 'Platform Admin'),
    actor.email,
    coalesce(actor.role_label, 'Super Admin'),
    coalesce(actor.role_rank, 100),
    p_action,
    p_entity_type,
    p_entity_id,
    jsonb_build_object(
      'feature', 'platform_club_access',
      'operation', p_action
    ) || coalesce(p_metadata, '{}'::jsonb),
    'security',
    case when p_outcome = 'success' then 'info' else 'warning' end,
    p_outcome,
    p_correlation_id,
    'netlify_function'
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

revoke all on function public.platform_access_audit_v1(uuid, uuid, text, text, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.platform_access_audit_v1(uuid, uuid, text, text, uuid, text, uuid, jsonb)
  to service_role;

comment on function public.platform_access_audit_v1(uuid, uuid, text, text, uuid, text, uuid, jsonb)
  is 'Writes fail-closed Platform Club Access audit events using an allowed audit source and feature metadata.';

commit;
