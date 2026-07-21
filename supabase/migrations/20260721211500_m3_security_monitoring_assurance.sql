-- FP-V1-SECURITY-M3-SUPPLY-GOVERNANCE-ASSURANCE-IMPLEMENT-01
-- Extends the existing audit_logs platform. No business rows are created or changed.

alter table public.audit_logs
  add column if not exists event_category text not null default 'operational',
  add column if not exists severity text not null default 'info',
  add column if not exists outcome text not null default 'success',
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists source text not null default 'application',
  add column if not exists retention_until timestamptz not null default (timezone('utc', now()) + interval '400 days');

alter table public.audit_logs
  drop constraint if exists audit_logs_event_category_check,
  add constraint audit_logs_event_category_check
    check (event_category in ('authentication', 'authority', 'data_access', 'data_change', 'delivery', 'operational', 'platform', 'recovery', 'security')),
  drop constraint if exists audit_logs_severity_check,
  add constraint audit_logs_severity_check
    check (severity in ('info', 'notice', 'warning', 'error', 'critical')),
  drop constraint if exists audit_logs_outcome_check,
  add constraint audit_logs_outcome_check
    check (outcome in ('success', 'denied', 'failure', 'partial')),
  drop constraint if exists audit_logs_source_check,
  add constraint audit_logs_source_check
    check (source in ('application', 'database', 'netlify_function', 'scheduled_monitor')),
  drop constraint if exists audit_logs_retention_window_check,
  add constraint audit_logs_retention_window_check
    check (retention_until >= created_at + interval '30 days' and retention_until <= created_at + interval '730 days');

create index if not exists audit_logs_security_monitor_idx
  on public.audit_logs (created_at desc, severity, outcome, event_category);

create index if not exists audit_logs_retention_idx
  on public.audit_logs (retention_until, created_at)
  where retention_until is not null;

create or replace function app_private.redact_security_audit_metadata(
  p_value jsonb,
  p_depth integer default 0
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, app_private
as $$
declare
  item record;
  result jsonb;
begin
  if p_value is null then
    return '{}'::jsonb;
  end if;

  if p_depth >= 4 then
    return to_jsonb('[truncated]'::text);
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      result := '{}'::jsonb;
      for item in select key, value from pg_catalog.jsonb_each(p_value) loop
        if item.key ~* '(authorization|cookie|credential|email|password|phone|recipient|secret|session|token|address)' then
          result := result || pg_catalog.jsonb_build_object(item.key, '[redacted]');
        else
          result := result || pg_catalog.jsonb_build_object(
            item.key,
            app_private.redact_security_audit_metadata(item.value, p_depth + 1)
          );
        end if;
      end loop;
      return result;
    when 'array' then
      select coalesce(pg_catalog.jsonb_agg(
        app_private.redact_security_audit_metadata(value, p_depth + 1)
        order by ordinal
      ), '[]'::jsonb)
      into result
      from (
        select value, ordinal
        from pg_catalog.jsonb_array_elements(p_value) with ordinality as values_with_ordinality(value, ordinal)
        where ordinal <= 50
      ) bounded_values;
      return result;
    when 'string' then
      return to_jsonb(pg_catalog.left(p_value #>> '{}', 256));
    else
      return p_value;
  end case;
end;
$$;

revoke all on function app_private.redact_security_audit_metadata(jsonb, integer) from public;
revoke all on function app_private.redact_security_audit_metadata(jsonb, integer) from anon;
revoke all on function app_private.redact_security_audit_metadata(jsonb, integer) from authenticated;

create or replace function public.record_security_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_correlation_id uuid default null,
  p_severity text default 'info',
  p_outcome text default 'success',
  p_event_category text default 'operational',
  p_source text default 'application'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  actor public.users%rowtype;
  event_id uuid;
  normalized_action text := pg_catalog.left(pg_catalog.btrim(coalesce(p_action, '')), 120);
  normalized_entity_type text := pg_catalog.left(pg_catalog.btrim(coalesce(p_entity_type, '')), 80);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated actor required';
  end if;

  select users.*
  into actor
  from public.users
  where users.id = auth.uid();

  if not found then
    raise exception using errcode = '42501', message = 'Authoritative actor profile required';
  end if;

  if normalized_action = '' or normalized_entity_type = '' then
    raise exception using errcode = '22023', message = 'Audit action and entity type are required';
  end if;

  if p_severity not in ('info', 'notice', 'warning', 'error', 'critical')
    or p_outcome not in ('success', 'denied', 'failure', 'partial')
    or p_event_category not in ('authentication', 'authority', 'data_access', 'data_change', 'delivery', 'operational', 'platform', 'recovery', 'security')
    or p_source not in ('application', 'database', 'netlify_function', 'scheduled_monitor') then
    raise exception using errcode = '22023', message = 'Invalid audit event classification';
  end if;

  insert into public.audit_logs (
    club_id,
    actor_id,
    actor_name,
    actor_email,
    actor_role_label,
    actor_role_rank,
    action,
    entity_type,
    entity_id,
    metadata,
    event_category,
    severity,
    outcome,
    correlation_id,
    source
  ) values (
    actor.club_id,
    actor.id,
    coalesce(nullif(actor.username, ''), nullif(actor.name, ''), 'User'),
    '',
    coalesce(nullif(actor.role_label, ''), actor.role, ''),
    coalesce(actor.role_rank, 0),
    normalized_action,
    normalized_entity_type,
    p_entity_id,
    app_private.redact_security_audit_metadata(coalesce(p_metadata, '{}'::jsonb)),
    p_event_category,
    p_severity,
    p_outcome,
    coalesce(p_correlation_id, gen_random_uuid()),
    p_source
  )
  returning id into event_id;

  return event_id;
end;
$$;

revoke all on function public.record_security_audit_event(text, text, uuid, jsonb, uuid, text, text, text, text) from public;
revoke all on function public.record_security_audit_event(text, text, uuid, jsonb, uuid, text, text, text, text) from anon;
grant execute on function public.record_security_audit_event(text, text, uuid, jsonb, uuid, text, text, text, text) to authenticated;

revoke insert, update, delete, truncate on table public.audit_logs from public;
revoke insert, update, delete, truncate on table public.audit_logs from anon;
revoke insert, update, delete, truncate on table public.audit_logs from authenticated;

drop policy if exists audit_logs_insert_scoped on public.audit_logs;

create or replace function public.security_audit_monitor_summary(
  p_window_minutes integer default 15
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  bounded_window integer := least(greatest(coalesce(p_window_minutes, 15), 5), 1440);
  result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;

  select pg_catalog.jsonb_build_object(
    'windowMinutes', bounded_window,
    'total', count(*),
    'critical', count(*) filter (where severity = 'critical'),
    'errors', count(*) filter (where severity = 'error'),
    'denied', count(*) filter (where outcome = 'denied'),
    'failures', count(*) filter (where outcome = 'failure'),
    'authorityFailures', count(*) filter (where event_category = 'authority' and outcome in ('denied', 'failure')),
    'authenticationFailures', count(*) filter (where event_category = 'authentication' and outcome in ('denied', 'failure')),
    'latestEventAt', max(created_at)
  )
  into result
  from public.audit_logs
  where created_at >= timezone('utc', now()) - pg_catalog.make_interval(mins => bounded_window);

  return result;
end;
$$;

revoke all on function public.security_audit_monitor_summary(integer) from public;
revoke all on function public.security_audit_monitor_summary(integer) from anon;
revoke all on function public.security_audit_monitor_summary(integer) from authenticated;
grant execute on function public.security_audit_monitor_summary(integer) to service_role;

create or replace function public.prune_expired_security_audit_events(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
  bounded_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;

  with expired as (
    select id
    from public.audit_logs
    where retention_until <= timezone('utc', now())
    order by retention_until, id
    limit bounded_limit
    for update skip locked
  ), deleted as (
    delete from public.audit_logs logs
    using expired
    where logs.id = expired.id
    returning logs.id
  )
  select count(*)::integer into deleted_count from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.prune_expired_security_audit_events(integer) from public;
revoke all on function public.prune_expired_security_audit_events(integer) from anon;
revoke all on function public.prune_expired_security_audit_events(integer) from authenticated;
grant execute on function public.prune_expired_security_audit_events(integer) to service_role;

comment on function public.record_security_audit_event(text, text, uuid, jsonb, uuid, text, text, text, text) is
  'Writes a redacted audit event using the authenticated server-derived actor and tenant.';
comment on function public.security_audit_monitor_summary(integer) is
  'Read-only bounded security audit summary for the authenticated native scheduled monitor.';
comment on function public.prune_expired_security_audit_events(integer) is
  'Bounded service-role retention operation. Deletes only audit rows past their retention deadline.';
