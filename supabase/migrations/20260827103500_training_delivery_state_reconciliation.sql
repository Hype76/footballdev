-- Reconcile Training invitation rows only when the immutable email log proves
-- that the provider accepted or delivered the exact request-player message.
-- This migration sends no communication and changes no Player, Team, event,
-- response, or membership row.

with authoritative_delivery as (
  select distinct on (request_player_id)
    request_player_id,
    log.provider_message_id,
    log.delivery_state,
    coalesce(log.provider_delivered_at, log.provider_accepted_at, log.updated_at, log.created_at) as accepted_at
  from (
    select
      email_logs.*,
      email_logs.payload #>> '{trainingInvitation,requestPlayerId}' as request_player_id
    from public.email_logs
    where email_logs.payload #>> '{trainingInvitation,requestPlayerId}' is not null
      and email_logs.provider_message_id is not null
      and email_logs.delivery_state in (
        'provider_accepted'::public.email_delivery_state_v1,
        'delivered'::public.email_delivery_state_v1
      )
  ) as log
  where request_player_id <> ''
  order by request_player_id, accepted_at desc, log.id desc
), linked_delivery as (
  select
    request_player.id as request_player_id,
    request_player.email_queue_id,
    authoritative_delivery.provider_message_id,
    authoritative_delivery.delivery_state,
    authoritative_delivery.accepted_at
  from public.training_availability_request_players as request_player
  join authoritative_delivery
    on authoritative_delivery.request_player_id = request_player.id::text
  where request_player.email_queue_id is not null
)
update public.scheduled_email_queue as queue
set
  status = 'sent',
  delivery_state = case
    when linked_delivery.delivery_state = 'delivered'::public.email_delivery_state_v1
      then 'delivered'::public.email_delivery_state_v1
    else 'provider_accepted'::public.email_delivery_state_v1
  end,
  provider_message_id = linked_delivery.provider_message_id,
  provider_accepted_at = coalesce(queue.provider_accepted_at, linked_delivery.accepted_at),
  provider_delivered_at = case
    when linked_delivery.delivery_state = 'delivered'::public.email_delivery_state_v1
      then coalesce(queue.provider_delivered_at, linked_delivery.accepted_at)
    else queue.provider_delivered_at
  end,
  last_error = null,
  failure_category = null,
  safe_error_code = null,
  next_retry_at = null,
  terminal_at = null,
  lease_owner = null,
  leased_at = null,
  lease_expires_at = null
from linked_delivery
where queue.id = linked_delivery.email_queue_id
  and (
    queue.status <> 'sent'
    or queue.provider_message_id is distinct from linked_delivery.provider_message_id
    or queue.delivery_state not in (
      'provider_accepted'::public.email_delivery_state_v1,
      'delivered'::public.email_delivery_state_v1
    )
    or queue.last_error is not null
  );

with authoritative_delivery as (
  select distinct on (request_player_id)
    request_player_id,
    coalesce(log.provider_delivered_at, log.provider_accepted_at, log.updated_at, log.created_at) as accepted_at
  from (
    select
      email_logs.*,
      email_logs.payload #>> '{trainingInvitation,requestPlayerId}' as request_player_id
    from public.email_logs
    where email_logs.payload #>> '{trainingInvitation,requestPlayerId}' is not null
      and email_logs.provider_message_id is not null
      and email_logs.delivery_state in (
        'provider_accepted'::public.email_delivery_state_v1,
        'delivered'::public.email_delivery_state_v1
      )
  ) as log
  where request_player_id <> ''
  order by request_player_id, accepted_at desc, log.id desc
)
update public.training_availability_request_players as request_player
set
  status = case
    when exists (
      select 1
      from public.training_availability_responses as response
      where response.request_id = request_player.request_id
        and response.player_id = request_player.player_id
    ) then 'responded'
    else 'sent'
  end,
  email_sent_at = coalesce(request_player.email_sent_at, authoritative_delivery.accepted_at),
  last_error = null
from authoritative_delivery
where authoritative_delivery.request_player_id = request_player.id::text
  and (
    request_player.status not in ('sent', 'responded')
    or request_player.email_sent_at is null
    or request_player.last_error is not null
  );
