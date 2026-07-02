revoke all on public.staff_chat_conversations from public;
revoke all on public.staff_chat_members from public;
revoke all on public.staff_chat_messages from public;
revoke all on public.staff_chat_conversations from anon;
revoke all on public.staff_chat_members from anon;
revoke all on public.staff_chat_messages from anon;
revoke all on public.staff_chat_conversations from authenticated;
revoke all on public.staff_chat_members from authenticated;
revoke all on public.staff_chat_messages from authenticated;

grant select, insert, update on public.staff_chat_conversations to authenticated;
grant select, insert, update on public.staff_chat_members to authenticated;
grant select, insert, update on public.staff_chat_messages to authenticated;
