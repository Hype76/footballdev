-- Record the temporary live rollback made while release scope was clarified.
alter function public.apply_coach_match_day_command(uuid, uuid, text, jsonb, timestamptz, timestamptz, uuid)
  reset lock_timeout;

alter function public.apply_coach_match_day_command_v2(uuid, uuid, text, jsonb, timestamptz, timestamptz, uuid)
  reset lock_timeout;
