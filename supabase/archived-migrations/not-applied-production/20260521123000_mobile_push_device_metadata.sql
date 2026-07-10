alter table public.mobile_push_devices
add column if not exists metadata jsonb not null default '{}'::jsonb;
