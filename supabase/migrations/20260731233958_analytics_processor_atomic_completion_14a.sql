create or replace function public.complete_platform_analytics_processor_run(
  run_id_value uuid,
  event_ids_value uuid[],
  finished_at_value timestamptz,
  rows_scanned_value integer,
  rows_accepted_value integer,
  rows_rejected_value integer,
  rows_unattributed_value integer,
  rows_aggregated_value integer,
  watermark_after_value timestamptz,
  audit_watermark_after_value timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.analytics_processor_runs
    where id = run_id_value
      and status = 'running'
    for update
  ) then
    raise exception 'Analytics processor run is not active.' using errcode = '55000';
  end if;

  update public.analytics_events
  set processed_at = finished_at_value,
      processor_run_id = run_id_value
  where id = any(coalesce(event_ids_value, '{}'::uuid[]))
    and processed_at is null;

  update public.analytics_processor_runs
  set status = 'succeeded',
      finished_at = finished_at_value,
      rows_scanned = rows_scanned_value,
      rows_accepted = rows_accepted_value,
      rows_rejected = rows_rejected_value,
      rows_unattributed = rows_unattributed_value,
      rows_aggregated = rows_aggregated_value,
      failure_category = null,
      watermark_after = watermark_after_value
  where id = run_id_value;

  update public.analytics_processor_state
  set watermark_received_at = watermark_after_value,
      audit_watermark_created_at = audit_watermark_after_value,
      last_successful_run_id = run_id_value,
      updated_at = finished_at_value
  where singleton;
end;
$$;

revoke all on function public.complete_platform_analytics_processor_run(
  uuid, uuid[], timestamptz, integer, integer, integer, integer, integer, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_platform_analytics_processor_run(
  uuid, uuid[], timestamptz, integer, integer, integer, integer, integer, timestamptz, timestamptz
) to service_role;

comment on function public.complete_platform_analytics_processor_run(
  uuid, uuid[], timestamptz, integer, integer, integer, integer, integer, timestamptz, timestamptz
) is 'Atomically marks analytics events processed and persists the successful processor ledger and watermarks.';
