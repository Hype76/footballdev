-- Parent accounts can be authorised through parent_player_links without having a
-- public.users staff profile. Preserve the authenticated identity in audit
-- metadata, but only write audit_logs.actor_id when the referenced staff profile
-- exists so a successful Parent Chat message is never rolled back by the audit.
create or replace function public.record_player_chat_audit(
  actor_id_value uuid,
  club_id_value uuid,
  action_value text,
  entity_id_value uuid,
  outcome_value text,
  metadata_value jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_record public.users%rowtype;
  actor_auth_email text;
  actor_auth_name text;
  audit_actor_id uuid;
begin
  select * into actor_record
  from public.users
  where id = actor_id_value;

  select
    lower(btrim(coalesce(auth_actor.email, ''))),
    coalesce(
      nullif(btrim(auth_actor.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(auth_actor.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(lower(btrim(coalesce(auth_actor.email, ''))), '@', 1), '')
    )
  into actor_auth_email, actor_auth_name
  from auth.users auth_actor
  where auth_actor.id = actor_id_value;

  audit_actor_id := actor_record.id;

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
    event_category,
    severity,
    outcome,
    source,
    metadata
  ) values (
    club_id_value,
    audit_actor_id,
    coalesce(
      nullif(actor_record.name, ''),
      nullif(actor_record.email, ''),
      actor_auth_name,
      actor_auth_email,
      'Authenticated user'
    ),
    coalesce(nullif(actor_record.email, ''), actor_auth_email),
    coalesce(nullif(actor_record.role_label, ''), actor_record.role, 'parent'),
    coalesce(actor_record.role_rank, 0),
    action_value,
    'player_chat_conversation',
    entity_id_value,
    'data_change',
    case when outcome_value = 'success' then 'info' else 'warning' end,
    outcome_value,
    'database',
    coalesce(metadata_value, '{}'::jsonb)
      || case
        when audit_actor_id is null and actor_id_value is not null
          then jsonb_build_object('actorAuthUserId', actor_id_value)
        else '{}'::jsonb
      end
  );
end;
$$;

revoke all on function public.record_player_chat_audit(uuid, uuid, text, uuid, text, jsonb) from public;
grant execute on function public.record_player_chat_audit(uuid, uuid, text, uuid, text, jsonb) to service_role;
