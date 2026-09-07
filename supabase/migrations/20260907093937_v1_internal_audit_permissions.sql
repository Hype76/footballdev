-- Internal audit writers are called by postgres-owned SECURITY DEFINER workflows.
-- Preserve those nested calls and service operations, deny direct client execution.
-- No application deployment is needed for this permission-only migration.
revoke all on function public.record_player_chat_audit(uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_adult_player_response_audit_internal(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- These eight helpers use only pg_catalog builtins and NEW trigger records.
-- An empty path still resolves pg_catalog implicitly and excludes writable schemas.
alter function public.set_players_updated_at() set search_path = '';
alter function public.set_tester_feedback_reports_updated_at() set search_path = '';
alter function public.set_email_logs_updated_at() set search_path = '';
alter function public.set_calendar_event_invites_updated_at() set search_path = '';
alter function public.get_initials_from_full_name(text) set search_path = '';
alter function public.set_scheduled_email_queue_updated_at() set search_path = '';
alter function public.normalize_subscription_plan_key(text) set search_path = '';
alter function public.set_parent_email_templates_updated_at() set search_path = '';
