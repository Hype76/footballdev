-- Keep the canonical Platform Analytics workspace rollup bounded as Parent
-- authority grows. The previous multi-fact join multiplied Teams, Players,
-- assignments, Development records, contacts, and Parent links before
-- deduplicating them.

do $migration$
declare
  function_definition text;
  old_workspace_rollup text := $old$workspace_rollup as (
  select
    workspace.id,
    workspace.name,
    workspace.plan_key,
    workspace.workspace_scope,
    count(distinct team.id)::integer as team_count,
    count(distinct player.id)::integer as active_player_count,
    count(distinct assignment.id)::integer as staff_assignment_count,
    count(distinct development.id)::integer as development_record_count,
    count(distinct contact.contact_key)::integer as parent_contact_count,
    count(distinct (parent_link.auth_user_id, parent_link.player_id)) filter (
      where parent_link.auth_user_id is not null
        and parent_link.player_id is not null
    )::integer as active_parent_link_count
  from eligible_workspaces workspace
  left join eligible_teams team on team.club_id = workspace.id
  left join eligible_players player on player.team_id = team.id
  left join valid_staff_assignments assignment on assignment.team_id = team.id
  left join eligible_development_records development on development.club_id = workspace.id
  left join current_parent_contacts contact on contact.club_id = workspace.id
  left join valid_parent_links parent_link on parent_link.club_id = workspace.id
  group by workspace.id, workspace.name, workspace.plan_key, workspace.workspace_scope
),$old$;
  corrected_workspace_rollup text := $new$workspace_rollup as (
  select
    workspace.id,
    workspace.name,
    workspace.plan_key,
    workspace.workspace_scope,
    (select count(*)::integer from eligible_teams team where team.club_id = workspace.id) as team_count,
    (select count(*)::integer from eligible_players player where player.club_id = workspace.id) as active_player_count,
    (select count(*)::integer from valid_staff_assignments assignment where assignment.club_id = workspace.id) as staff_assignment_count,
    (select count(*)::integer from eligible_development_records development where development.club_id = workspace.id) as development_record_count,
    (select count(distinct contact.contact_key)::integer from current_parent_contacts contact where contact.club_id = workspace.id) as parent_contact_count,
    (
      select count(distinct (parent_link.auth_user_id, parent_link.player_id))::integer
      from valid_parent_links parent_link
      where parent_link.club_id = workspace.id
        and parent_link.auth_user_id is not null
        and parent_link.player_id is not null
    ) as active_parent_link_count
  from eligible_workspaces workspace
),$new$;
begin
  select pg_get_functiondef(
    'public.get_platform_analytics_canonical_v4(date,date,uuid,text,text,text,text,text,text,boolean,boolean)'::regprocedure
  ) into function_definition;

  function_definition := replace(function_definition, chr(13) || chr(10), chr(10));
  old_workspace_rollup := replace(old_workspace_rollup, chr(13) || chr(10), chr(10));
  corrected_workspace_rollup := replace(corrected_workspace_rollup, chr(13) || chr(10), chr(10));

  if position(old_workspace_rollup in function_definition) > 0 then
    function_definition := replace(function_definition, old_workspace_rollup, corrected_workspace_rollup);
  elsif position(corrected_workspace_rollup in function_definition) = 0 then
    raise exception 'Canonical analytics workspace rollup definition was not recognised';
  end if;

  execute function_definition;
end;
$migration$;

comment on function public.get_platform_analytics_canonical_v4(date, date, uuid, text, text, text, text, text, text, boolean, boolean) is
'Canonical privacy-safe Platform Analytics report with authority-aligned Parent counts and bounded per-workspace rollups.';
