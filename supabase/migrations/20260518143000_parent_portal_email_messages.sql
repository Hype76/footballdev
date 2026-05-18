create or replace function public.get_parent_portal_email_messages(parent_link_id_value uuid)
returns table (
  id uuid,
  player_id uuid,
  evaluation_id uuid,
  sender_name text,
  sender_email text,
  recipient_email text,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    log.id,
    log.player_id,
    log.evaluation_id,
    log.user_name as sender_name,
    log.user_email as sender_email,
    log.recipient_email,
    log.metadata,
    log.created_at
  from public.communication_logs log
  join public.parent_player_links link
    on link.id = parent_link_id_value
    and link.auth_user_id = auth.uid()
    and link.status = 'active'
    and link.player_id = log.player_id
    and link.club_id = log.club_id
  where auth.uid() is not null
    and log.channel = 'email'
    and log.action = 'parent_email_sent'
  order by log.created_at desc;
$$;

grant execute on function public.get_parent_portal_email_messages(uuid) to authenticated;
