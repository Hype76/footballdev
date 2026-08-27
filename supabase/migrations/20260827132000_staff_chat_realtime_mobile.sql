-- FP-MATCH-INVITE-MOBILE-114
-- Parent Chat messages are already published. Add the RLS-protected staff message
-- table so an open Coach mobile conversation can refresh immediately.

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'staff_chat_messages'
  ) then
    alter publication supabase_realtime add table public.staff_chat_messages;
  end if;
end;
$$;
