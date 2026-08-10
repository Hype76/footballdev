-- FP-MOBILE-COMMS-POLLS-PRIVACY-CORRECTIVE-36A
-- Parent communication history is recipient-scoped, not family- or child-scoped.

create or replace function public.get_parent_portal_email_messages(parent_link_id_value uuid)
returns table (
  id uuid,
  player_id uuid,
  evaluation_id uuid,
  sender_name text,
  sender_email text,
  recipient_email text,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    log.id,
    log.player_id,
    log.evaluation_id,
    log.user_name as sender_name,
    log.user_email as sender_email,
    log.recipient_email,
    log.metadata,
    read_log.read_at,
    log.created_at
  from public.communication_logs log
  join public.parent_player_links link
    on link.id = parent_link_id_value
    and link.player_id = log.player_id
    and link.club_id = log.club_id
  left join public.parent_portal_message_reads read_log
    on read_log.parent_link_id = link.id
    and read_log.communication_log_id = log.id
    and read_log.auth_user_id = (select auth.uid())
  where public.current_user_can_access_parent_link(link.id, log.player_id)
    and log.channel = 'email'
    and log.action = 'parent_email_sent'
    and case
      when nullif(btrim(log.metadata ->> 'recipientLinkId'), '') is not null then
        btrim(log.metadata ->> 'recipientLinkId') = link.id::text
      else
        nullif(lower(btrim(link.email)), '') is not null
        and exists (
          select 1
          from pg_catalog.regexp_split_to_table(
            lower(coalesce(log.recipient_email, '')),
            E'\\s*,\\s*'
          ) as recipient(recipient_email)
          where nullif(btrim(recipient.recipient_email), '') = lower(btrim(link.email))
        )
    end
  order by log.created_at desc;
$$;

create or replace function public.mark_parent_portal_message_read(
  parent_link_id_value uuid,
  communication_log_id_value uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  read_timestamp timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required before opening this message.';
  end if;

  if not exists (
    select 1
    from public.parent_player_links link
    join public.communication_logs log
      on log.id = communication_log_id_value
      and log.player_id = link.player_id
      and log.club_id = link.club_id
      and log.channel = 'email'
      and log.action = 'parent_email_sent'
    where link.id = parent_link_id_value
      and public.current_user_can_access_parent_link(link.id, log.player_id)
      and case
        when nullif(btrim(log.metadata ->> 'recipientLinkId'), '') is not null then
          btrim(log.metadata ->> 'recipientLinkId') = link.id::text
        else
          nullif(lower(btrim(link.email)), '') is not null
          and exists (
            select 1
            from pg_catalog.regexp_split_to_table(
              lower(coalesce(log.recipient_email, '')),
              E'\\s*,\\s*'
            ) as recipient(recipient_email)
            where nullif(btrim(recipient.recipient_email), '') = lower(btrim(link.email))
          )
      end
  ) then
    raise exception 'This message could not be opened.';
  end if;

  insert into public.parent_portal_message_reads (
    parent_link_id,
    communication_log_id,
    auth_user_id
  )
  values (
    parent_link_id_value,
    communication_log_id_value,
    (select auth.uid())
  )
  on conflict (parent_link_id, communication_log_id, auth_user_id)
  do update set read_at = public.parent_portal_message_reads.read_at
  returning read_at into read_timestamp;

  return read_timestamp;
end;
$$;

revoke all on function public.get_parent_portal_email_messages(uuid) from public, anon;
revoke all on function public.mark_parent_portal_message_read(uuid, uuid) from public, anon;

grant execute on function public.get_parent_portal_email_messages(uuid) to authenticated, service_role;
grant execute on function public.mark_parent_portal_message_read(uuid, uuid) to authenticated, service_role;

comment on function public.get_parent_portal_email_messages(uuid) is
  'Returns only communication history explicitly addressed to the authenticated active Parent link.';

comment on function public.mark_parent_portal_message_read(uuid, uuid) is
  'Marks a Parent communication read only when the authenticated active Parent link is an explicit recipient.';
