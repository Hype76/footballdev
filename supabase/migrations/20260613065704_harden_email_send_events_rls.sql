alter table public.email_send_events enable row level security;

revoke all privileges on table public.email_send_events from anon;
revoke all privileges on table public.email_send_events from authenticated;
revoke all privileges on table public.email_send_events from PUBLIC;

grant select, insert, update, delete on table public.email_send_events to service_role;

comment on table public.email_send_events is
  'Server-side email duplicate-send event log. Direct client access is revoked; Netlify functions use the service-role admin client.';
