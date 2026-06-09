drop policy if exists calendar_events_insert_scoped on public.calendar_events;
create policy calendar_events_insert_scoped
on public.calendar_events
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and created_by = auth.uid()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    (
      team_id is null
      and public.current_user_role() = 'admin'
    )
    or (
      team_id is not null
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = calendar_events.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
);

drop policy if exists calendar_events_update_scoped on public.calendar_events;
create policy calendar_events_update_scoped
on public.calendar_events
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    (
      team_id is null
      and public.current_user_role() = 'admin'
    )
    or (
      team_id is not null
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = calendar_events.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
)
with check (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    (
      team_id is null
      and public.current_user_role() = 'admin'
    )
    or (
      team_id is not null
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = calendar_events.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
);

drop policy if exists calendar_events_delete_scoped on public.calendar_events;
create policy calendar_events_delete_scoped
on public.calendar_events
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    (
      team_id is null
      and public.current_user_role() = 'admin'
    )
    or (
      team_id is not null
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = calendar_events.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
);
