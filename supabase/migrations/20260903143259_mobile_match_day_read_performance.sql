-- Finish the shared screen read path. Reuse the already-tested Team scope for
-- Match Day reads, and evaluate row-independent identity checks once per query.
drop policy if exists match_days_staff_select_scoped on public.match_days;
create policy match_days_staff_select_scoped on public.match_days
for select to authenticated using (
  (select public.current_user_role()) = 'super_admin'
  or (club_id, team_id) in (select scope.club_id, scope.team_id from private.mobile_authorized_team_scope() scope)
);

drop policy if exists match_day_player_availability_staff_select_exact_team on public.match_day_player_availability;
create policy match_day_player_availability_staff_select_exact_team on public.match_day_player_availability
for select to authenticated using (
  (select public.current_user_role()) = 'super_admin'
  or (club_id, team_id) in (select scope.club_id, scope.team_id from private.mobile_authorized_team_scope() scope)
);

drop policy if exists assessment_sessions_select_scoped on public.assessment_sessions;
create policy assessment_sessions_select_scoped on public.assessment_sessions
for select to authenticated using ((((select public.current_user_role()) = 'super_admin'::text) OR ((club_id = (select public.current_user_club_id())) AND ((created_by = (select auth.uid())) OR ((select public.current_user_role_rank()) >= 50) OR (EXISTS ( SELECT 1
   FROM team_staff ts
  WHERE ((ts.team_id = assessment_sessions.team_id) AND (ts.user_id = (select auth.uid())))))))));

drop policy if exists calendar_event_invites_select_scoped on public.calendar_event_invites;
create policy calendar_event_invites_select_scoped on public.calendar_event_invites
for select to authenticated using ((((select public.current_user_role()) = 'super_admin'::text) OR (EXISTS ( SELECT 1
   FROM parent_player_links link
  WHERE ((link.player_id = calendar_event_invites.player_id) AND (link.club_id = calendar_event_invites.club_id) AND (link.auth_user_id = (select auth.uid())) AND (link.status = 'active'::text)))) OR ((club_id = (select public.current_user_club_id())) AND ((select public.current_user_role_rank()) >= 20) AND (((select public.current_user_role_rank()) >= 50) OR (EXISTS ( SELECT 1
   FROM team_staff ts
  WHERE ((ts.team_id = calendar_event_invites.team_id) AND (ts.user_id = (select auth.uid())))))))));

drop policy if exists calendar_events_select_scoped on public.calendar_events;
create policy calendar_events_select_scoped on public.calendar_events
for select to authenticated using ((((select public.current_user_role()) = 'super_admin'::text) OR ((club_id = (select public.current_user_club_id())) AND ((select public.current_user_role()) <> 'parent_portal'::text) AND ((team_id IS NULL) OR ((select public.current_user_role_rank()) >= 50) OR (EXISTS ( SELECT 1
   FROM team_staff ts
  WHERE ((ts.team_id = calendar_events.team_id) AND (ts.user_id = (select auth.uid())))))))));
