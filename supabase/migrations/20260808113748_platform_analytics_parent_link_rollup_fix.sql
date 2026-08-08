do $migration$
declare
  function_definition text;
  old_expression constant text :=
    'count(distinct (parent_link.auth_user_id, parent_link.player_id))::integer as active_parent_link_count';
  corrected_expression constant text :=
    'count(distinct (parent_link.auth_user_id, parent_link.player_id)) filter (' || chr(10) ||
    '      where parent_link.auth_user_id is not null' || chr(10) ||
    '        and parent_link.player_id is not null' || chr(10) ||
    '    )::integer as active_parent_link_count';
begin
  select pg_get_functiondef(
    'public.get_platform_analytics_canonical_v4(date,date,uuid,text,text,text,text,text,text,boolean,boolean)'::regprocedure
  )
  into function_definition;

  if position(old_expression in function_definition) > 0 then
    execute replace(function_definition, old_expression, corrected_expression);
  elsif position(corrected_expression in function_definition) = 0 then
    raise exception 'Canonical analytics Parent-link rollup expression was not recognised';
  end if;
end;
$migration$;

revoke all on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) to service_role;

comment on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) is
'Canonical service-role-only Platform Analytics report. Headline counts, human-readable breakdowns, trends, and internal reconciliations share the same authoritative definitions without returning account, Parent, player, or relationship identifiers. Parent-link workspace rollups exclude empty left-join rows.';
