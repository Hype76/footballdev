-- FP-V1-CALENDAR-INVITES-TRIALS-39B
-- Keep bearer-token response RPCs behind the server-owned Netlify boundary.

revoke all on function public.get_calendar_trial_event_response(text)
from public, anon, authenticated;
grant execute on function public.get_calendar_trial_event_response(text)
to service_role;

revoke all on function public.submit_calendar_trial_event_response(text, text)
from public, anon, authenticated;
grant execute on function public.submit_calendar_trial_event_response(text, text)
to service_role;

comment on function public.get_calendar_trial_event_response(text) is
  'Server-only lookup for one event-specific trial RSVP token hash. The public response page mediates access without exposing the RPC.';

comment on function public.submit_calendar_trial_event_response(text, text) is
  'Server-only event-specific trial RSVP mutation. The public response page mediates access and does not create Parent Portal identity.';
