begin;

do $$
begin
  if to_regprocedure('public.get_parent_chat_rooms()') is null then
    raise exception 'Required function public.get_parent_chat_rooms() is missing.';
  end if;
end;
$$;

revoke execute on function public.get_parent_chat_rooms() from anon;
grant execute on function public.get_parent_chat_rooms() to authenticated, service_role;

commit;
