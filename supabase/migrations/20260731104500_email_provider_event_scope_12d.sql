create or replace function public.record_email_provider_event_v1(
  webhook_event_id_value text,
  provider_message_id_value text,
  event_type_value text,
  occurred_at_value timestamptz,
  payload_sha256_value text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  normalized_type text := lower(btrim(coalesce(event_type_value, '')));
  normalized_message_id text := btrim(coalesce(provider_message_id_value, ''));
  resolved_state public.email_delivery_state_v1;
begin
  if btrim(coalesce(webhook_event_id_value, '')) = ''
    or normalized_message_id = ''
    or normalized_type not in (
      'email.delivered',
      'email.bounced',
      'email.complained',
      'email.delivery_delayed',
      'email.failed',
      'email.suppressed'
    ) then
    raise exception using errcode = '22023', message = 'invalid_email_provider_event';
  end if;

  if not (
    exists (
      select 1
      from public.email_delivery_jobs
      where provider_message_id = normalized_message_id
    )
    or exists (
      select 1
      from public.email_delivery_attempts
      where provider_message_id = normalized_message_id
    )
    or exists (
      select 1
      from public.email_logs
      where provider_message_id = normalized_message_id
    )
    or exists (
      select 1
      from public.scheduled_email_queue
      where provider_message_id = normalized_message_id
    )
  ) then
    return false;
  end if;

  insert into public.email_provider_events(
    webhook_event_id,
    provider_message_id,
    event_type,
    occurred_at,
    payload_sha256
  )
  values (
    btrim(webhook_event_id_value),
    normalized_message_id,
    normalized_type,
    coalesce(occurred_at_value, timezone('utc', now())),
    btrim(payload_sha256_value)
  )
  on conflict (webhook_event_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    return false;
  end if;

  resolved_state := case normalized_type
    when 'email.delivered' then 'delivered'::public.email_delivery_state_v1
    when 'email.delivery_delayed' then 'deferred'::public.email_delivery_state_v1
    when 'email.bounced' then 'bounced'::public.email_delivery_state_v1
    when 'email.complained' then 'complained'::public.email_delivery_state_v1
    when 'email.suppressed' then 'suppressed'::public.email_delivery_state_v1
    else 'failed'::public.email_delivery_state_v1
  end;

  update public.email_delivery_jobs
  set
    status = case when resolved_state = 'delivered' then 'delivered' else status end,
    provider_status = replace(normalized_type, 'email.', ''),
    provider_delivered_at = case when resolved_state = 'delivered' then coalesce(occurred_at_value, timezone('utc', now())) else provider_delivered_at end,
    failure_category = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then replace(normalized_type, 'email.', '') else failure_category end,
    updated_at = timezone('utc', now())
  where provider_message_id = normalized_message_id;

  update public.email_delivery_attempts
  set
    provider_status = replace(normalized_type, 'email.', ''),
    provider_delivered_at = case
      when resolved_state = 'delivered' then coalesce(occurred_at_value, timezone('utc', now()))
      else provider_delivered_at
    end
  where provider_message_id = normalized_message_id;

  update public.email_logs
  set
    delivery_state = resolved_state,
    provider_delivered_at = case when resolved_state = 'delivered' then coalesce(occurred_at_value, timezone('utc', now())) else provider_delivered_at end,
    failure_category = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then replace(normalized_type, 'email.', '') else failure_category end,
    terminal_at = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then coalesce(occurred_at_value, timezone('utc', now())) else terminal_at end,
    updated_at = timezone('utc', now())
  where provider_message_id = normalized_message_id;

  update public.scheduled_email_queue
  set
    delivery_state = resolved_state,
    provider_delivered_at = case when resolved_state = 'delivered' then coalesce(occurred_at_value, timezone('utc', now())) else provider_delivered_at end,
    failure_category = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then replace(normalized_type, 'email.', '') else failure_category end,
    terminal_at = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then coalesce(occurred_at_value, timezone('utc', now())) else terminal_at end,
    updated_at = timezone('utc', now())
  where provider_message_id = normalized_message_id;

  return true;
end;
$$;

revoke all on function public.record_email_provider_event_v1(text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_email_provider_event_v1(text, text, text, timestamptz, text)
  to service_role;

comment on function public.record_email_provider_event_v1(text, text, text, timestamptz, text) is
  'Persists authenticated provider evidence only for message IDs already issued by Footballplayer.';
