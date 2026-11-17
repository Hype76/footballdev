-- These service-only POST RPCs call the shared authority helper, which takes
-- key-share locks. PostgREST runs STABLE functions in read-only transactions.
alter function public.get_adult_player_link_status(uuid, uuid) volatile;
alter function public.list_adult_player_setup_resend_targets(uuid, uuid) volatile;
