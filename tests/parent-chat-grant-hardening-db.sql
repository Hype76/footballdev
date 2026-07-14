begin;

do $$
declare
  function_name text;
  function_record record;
begin
  foreach function_name in array array[
    'parent_chat_sync_parent_link',
    'parent_chat_sync_team_staff',
    'parent_chat_sync_squad_decision',
    'parent_chat_sync_match_day'
  ] loop
    select
      p.oid,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_get_userbyid(p.proowner) as owner_name,
      p.prosecdef,
      p.proconfig,
      p.prorettype
    into strict function_record
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = function_name
      and pg_get_function_identity_arguments(p.oid) = '';

    if function_record.owner_name <> 'postgres' then
      raise exception '% owner changed to %.', function_name, function_record.owner_name;
    end if;

    if not function_record.prosecdef then
      raise exception '% is no longer SECURITY DEFINER.', function_name;
    end if;

    if function_record.prorettype <> 'pg_catalog.trigger'::regtype then
      raise exception '% no longer returns trigger.', function_name;
    end if;

    if not coalesce(function_record.proconfig, array[]::text[]) @> array['search_path=""'] then
      raise exception '% lost its controlled empty search path.', function_name;
    end if;

    if has_function_privilege('public', function_record.oid, 'EXECUTE') then
      raise exception 'PUBLIC can still execute %().', function_name;
    end if;

    if has_function_privilege('anon', function_record.oid, 'EXECUTE') then
      raise exception 'anon can still execute %().', function_name;
    end if;

    if has_function_privilege('authenticated', function_record.oid, 'EXECUTE') then
      raise exception 'authenticated can still execute %().', function_name;
    end if;
  end loop;
end;
$$;

set local role anon;

do $$
begin
  begin
    perform public.parent_chat_sync_parent_link();
    raise exception 'anon unexpectedly invoked parent_chat_sync_parent_link().';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.parent_chat_sync_team_staff();
    raise exception 'anon unexpectedly invoked parent_chat_sync_team_staff().';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.parent_chat_sync_squad_decision();
    raise exception 'anon unexpectedly invoked parent_chat_sync_squad_decision().';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.parent_chat_sync_match_day();
    raise exception 'anon unexpectedly invoked parent_chat_sync_match_day().';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;

do $$
begin
  begin
    perform public.parent_chat_sync_parent_link();
    raise exception 'authenticated unexpectedly invoked parent_chat_sync_parent_link().';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.parent_chat_sync_team_staff();
    raise exception 'authenticated unexpectedly invoked parent_chat_sync_team_staff().';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.parent_chat_sync_squad_decision();
    raise exception 'authenticated unexpectedly invoked parent_chat_sync_squad_decision().';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.parent_chat_sync_match_day();
    raise exception 'authenticated unexpectedly invoked parent_chat_sync_match_day().';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
declare
  trigger_record record;
  expected record;
begin
  for expected in
    select *
    from (values
      ('parent_chat_parent_link_sync', 'parent_player_links', 'parent_chat_sync_parent_link'),
      ('parent_chat_team_staff_sync', 'team_staff', 'parent_chat_sync_team_staff'),
      ('parent_chat_squad_decision_sync', 'match_day_player_squad_decisions', 'parent_chat_sync_squad_decision'),
      ('parent_chat_match_day_sync', 'match_days', 'parent_chat_sync_match_day')
    ) as required(trigger_name, table_name, function_name)
  loop
    select
      t.tgenabled,
      p.proname as function_name
    into strict trigger_record
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace table_namespace on table_namespace.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace function_namespace on function_namespace.oid = p.pronamespace
    where not t.tgisinternal
      and t.tgname = expected.trigger_name
      and table_namespace.nspname = 'public'
      and c.relname = expected.table_name
      and function_namespace.nspname = 'public';

    if trigger_record.tgenabled <> 'O' then
      raise exception '% is not enabled.', expected.trigger_name;
    end if;

    if trigger_record.function_name <> expected.function_name then
      raise exception '% points to % instead of %.',
        expected.trigger_name,
        trigger_record.function_name,
        expected.function_name;
    end if;
  end loop;
end;
$$;

do $$
declare
  table_name text;
  table_record record;
begin
  foreach table_name in array array[
    'parent_chat_rooms',
    'parent_chat_memberships',
    'parent_chat_membership_audit',
    'parent_chat_messages'
  ] loop
    select c.relrowsecurity, c.relforcerowsecurity
    into strict table_record
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = table_name
      and c.relkind = 'r';

    if not table_record.relrowsecurity or not table_record.relforcerowsecurity then
      raise exception '% lost enabled or forced RLS.', table_name;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.parent_chat_messages', 'INSERT')
    or has_table_privilege('authenticated', 'public.parent_chat_messages', 'UPDATE')
    or has_table_privilege('authenticated', 'public.parent_chat_messages', 'DELETE') then
    raise exception 'authenticated regained direct Parent Chat message mutation privileges.';
  end if;
end;
$$;

do $$
declare
  function_record record;
  expected record;
begin
  for expected in
    select *
    from (values
      ('parent_chat_staff_can_access_team', 'uuid, uuid, uuid', true),
      ('parent_chat_parent_can_access_room', 'uuid, uuid', true),
      ('parent_chat_user_can_access_room', 'uuid, uuid', true),
      ('parent_chat_user_can_post_room', 'uuid, uuid', true),
      ('parent_chat_reconcile_room', 'uuid', false),
      ('parent_chat_ensure_rooms_for_current_user', '', true),
      ('get_parent_chat_rooms', '', true),
      ('get_parent_chat_messages', 'uuid', true),
      ('send_parent_chat_message', 'uuid, text', true),
      ('mark_parent_chat_room_read', 'uuid', true),
      ('delete_parent_chat_message', 'uuid', true)
    ) as required(function_name, identity_arguments, authenticated_expected)
  loop
    select p.oid
    into strict function_record
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = expected.function_name
      and oidvectortypes(p.proargtypes) = expected.identity_arguments;

    if has_function_privilege('public', function_record.oid, 'EXECUTE') then
      raise exception 'PUBLIC can execute application RPC %(%).',
        expected.function_name,
        expected.identity_arguments;
    end if;

    if has_function_privilege('anon', function_record.oid, 'EXECUTE') then
      raise exception 'anon can execute application RPC %(%).',
        expected.function_name,
        expected.identity_arguments;
    end if;

    if has_function_privilege('authenticated', function_record.oid, 'EXECUTE')
      <> expected.authenticated_expected then
      raise exception 'authenticated grant changed for %(%).',
        expected.function_name,
        expected.identity_arguments;
    end if;

    if not has_function_privilege('service_role', function_record.oid, 'EXECUTE') then
      raise exception 'service_role grant missing for %(%).',
        expected.function_name,
        expected.identity_arguments;
    end if;
  end loop;
end;
$$;

select 'Parent Chat grant-hardening metadata and denial tests passed.' as result;

rollback;
