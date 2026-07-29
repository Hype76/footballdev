alter function public.apply_event_player_changes(
  text,
  uuid,
  uuid[],
  text,
  uuid,
  boolean
)
rename to apply_event_player_changes_internal_20260729;

revoke all on function public.apply_event_player_changes_internal_20260729(
  text,
  uuid,
  uuid[],
  text,
  uuid,
  boolean
)
from public, anon, authenticated;

create or replace function public.apply_event_player_changes(
  source_type_value text,
  event_id_value uuid,
  selected_player_ids_value uuid[] default '{}'::uuid[],
  communication_mode_value text default 'none',
  request_token_value uuid default null,
  confirm_selected_removals_value boolean default false,
  confirm_resend_all_value boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_communication_mode text := lower(btrim(coalesce(communication_mode_value, 'none')));
begin
  if normalized_communication_mode = 'resend_all'
    and confirm_resend_all_value is not true
  then
    raise exception 'Confirm the separate resend-to-all action before continuing.'
      using errcode = 'P0001';
  end if;

  return public.apply_event_player_changes_internal_20260729(
    source_type_value,
    event_id_value,
    selected_player_ids_value,
    communication_mode_value,
    request_token_value,
    confirm_selected_removals_value
  );
end;
$$;

revoke all on function public.apply_event_player_changes(
  text,
  uuid,
  uuid[],
  text,
  uuid,
  boolean,
  boolean
)
from public, anon;

grant execute on function public.apply_event_player_changes(
  text,
  uuid,
  uuid[],
  text,
  uuid,
  boolean,
  boolean
)
to authenticated, service_role;

comment on function public.apply_event_player_changes(
  text,
  uuid,
  uuid[],
  text,
  uuid,
  boolean,
  boolean
) is
  'Applies participant changes separately from communications and requires an explicit server-side confirmation for resend-to-all.';
