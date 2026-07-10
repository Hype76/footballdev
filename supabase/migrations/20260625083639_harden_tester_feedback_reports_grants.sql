revoke all on public.tester_feedback_reports from anon;
revoke all on public.tester_feedback_reports from public;
revoke delete, truncate on public.tester_feedback_reports from authenticated;
grant select, insert, update on public.tester_feedback_reports to authenticated;
