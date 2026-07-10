create or replace function public.delete_platform_team_transaction(
  p_team_id uuid,
  p_club_id uuid,
  p_actor_id uuid,
  p_actor_email text default '',
  p_actor_name text default '',
  p_actor_role text default '',
  p_actor_role_label text default '',
  p_actor_role_rank integer default 0
)
returns table (
  deleted boolean,
  team_id uuid,
  club_id uuid,
  team_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_team record;
  deleted_count integer := 0;
  failure_sqlstate text;
  failure_message text;
  failure_constraint text;
begin
  if p_team_id is null then
    raise exception 'invalid_team_id' using errcode = '22023';
  end if;

  if p_club_id is null then
    raise exception 'invalid_club_id' using errcode = '22023';
  end if;

  select team.id, team.name, team.club_id
  into target_team
  from public.teams team
  where team.id = p_team_id
  for update;

  if target_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0001';
  end if;

  if target_team.club_id <> p_club_id then
    raise exception 'team_club_mismatch' using errcode = 'P0001';
  end if;

  begin
    delete from public.teams team
    where team.id = target_team.id
      and team.club_id = p_club_id;

    get diagnostics deleted_count = row_count;
  exception
    when foreign_key_violation then
      get stacked diagnostics
        failure_message = message_text,
        failure_constraint = constraint_name;

      raise exception 'deletion_conflict'
        using errcode = '23503',
          detail = failure_message,
          hint = failure_constraint;
  end;

  if deleted_count <> 1 then
    raise exception 'team_not_deleted' using errcode = 'P0001';
  end if;

  begin
    insert into public.audit_logs (
      club_id,
      actor_id,
      actor_email,
      actor_name,
      actor_role_label,
      actor_role_rank,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      target_team.club_id,
      p_actor_id,
      nullif(p_actor_email, ''),
      nullif(p_actor_name, ''),
      nullif(p_actor_role_label, ''),
      coalesce(p_actor_role_rank, 0),
      'platform_team_deleted',
      'team',
      target_team.id,
      jsonb_build_object(
        'teamName', target_team.name,
        'clubId', target_team.club_id,
        'actorRole', nullif(p_actor_role, '')
      )
    );
  exception
    when others then
      get stacked diagnostics
        failure_sqlstate = returned_sqlstate,
        failure_message = message_text,
        failure_constraint = constraint_name;

      raise exception 'audit_failed'
        using errcode = 'P0001',
          detail = failure_sqlstate || ': ' || failure_message,
          hint = failure_constraint;
  end;

  return query select true, target_team.id, target_team.club_id, target_team.name;
end;
$$;

revoke all on function public.delete_platform_team_transaction(uuid, uuid, uuid, text, text, text, text, integer)
from public, anon, authenticated;

grant execute on function public.delete_platform_team_transaction(uuid, uuid, uuid, text, text, text, text, integer)
to service_role;
