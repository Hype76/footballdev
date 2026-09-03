-- Count only readable, undeleted messages after this member's read marker.
-- The existing context RPC remains the authority for every returned room.
create or replace function public.get_staff_chat_unread_summary(active_team_id_value uuid)
returns table (id uuid, unread_count bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select scoped.id, (
    select count(*)
    from public.staff_chat_messages message
    where message.conversation_id = scoped.id
      and message.club_id = member.club_id
      and message.sender_id <> (select auth.uid())
      and message.deleted_at is null
      and message.created_at > coalesce(member.last_read_at, '-infinity'::timestamptz)
  ) as unread_count
  from public.get_staff_chat_conversation_ids(active_team_id_value) scoped
  join public.staff_chat_members member on member.conversation_id = scoped.id
    and member.user_id = (select auth.uid())
    and member.archived_at is null;
$$;

revoke all on function public.get_staff_chat_unread_summary(uuid) from public, anon;
grant execute on function public.get_staff_chat_unread_summary(uuid) to authenticated, service_role;
