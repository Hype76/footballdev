revoke all on function public.handle_match_day_available_auto_selection()
from public, anon, authenticated, service_role;

comment on function public.handle_match_day_available_auto_selection() is
  'Internal trigger-only automatic match selection handler. Direct execution is revoked from API roles, including service_role.';
