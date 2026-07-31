drop index if exists public.analytics_event_quarantine_source_idx;

create unique index analytics_event_quarantine_source_idx
on public.analytics_event_quarantine(source_kind, source_record_id, safe_reason);

comment on index public.analytics_event_quarantine_source_idx is
'Supports idempotent processor quarantine upserts through the server API conflict target.';
