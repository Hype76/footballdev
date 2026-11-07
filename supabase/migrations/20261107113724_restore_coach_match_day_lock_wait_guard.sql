-- Restore the live guard after confirmation that only OTA changes are paused.
alter function public.apply_coach_match_day_command(uuid, uuid, text, jsonb, timestamptz, timestamptz, uuid)
  set lock_timeout to '3s';

alter function public.apply_coach_match_day_command_v2(uuid, uuid, text, jsonb, timestamptz, timestamptz, uuid)
  set lock_timeout to '3s';
