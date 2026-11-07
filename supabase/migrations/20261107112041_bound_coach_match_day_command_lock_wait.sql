-- Keep one busy fixture from filling every Data API connection with row-lock waiters.
-- The mobile outbox retains uncertain commands with stable IDs and retries them.
alter function public.apply_coach_match_day_command(uuid, uuid, text, jsonb, timestamptz, timestamptz, uuid)
  set lock_timeout to '3s';

alter function public.apply_coach_match_day_command_v2(uuid, uuid, text, jsonb, timestamptz, timestamptz, uuid)
  set lock_timeout to '3s';
