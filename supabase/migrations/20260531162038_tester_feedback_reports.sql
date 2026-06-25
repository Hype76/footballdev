create table if not exists public.tester_feedback_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by_user_id uuid references public.users(id) on delete set null,
  submitted_by_email text not null default '',
  submitted_by_name text not null default '',
  role text not null default '',
  club_id uuid references public.clubs(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  module text not null default '',
  phase text not null default 'phase_1',
  route text not null default '',
  page_title text,
  feedback_type text not null default 'bug',
  severity text not null default 'medium',
  status text not null default 'new',
  resolution_state text not null default '',
  title text not null,
  summary text not null,
  reproduction_steps text not null default '',
  expected_result text not null default '',
  actual_result text not null default '',
  browser_device text not null default '',
  screenshot_url text,
  log_reference text,
  admin_notes text,
  constraint tester_feedback_reports_type_check check (
    feedback_type in ('bug', 'suggestion', 'confusion', 'missing_feature', 'praise', 'other')
  ),
  constraint tester_feedback_reports_severity_check check (
    severity in ('low', 'medium', 'high', 'critical')
  ),
  constraint tester_feedback_reports_status_check check (
    status in ('new', 'triaged', 'accepted', 'in_progress', 'fixed', 'rejected', 'duplicate', 'needs_info')
  )
);

create index if not exists tester_feedback_reports_created_at_idx
  on public.tester_feedback_reports (created_at desc);

create index if not exists tester_feedback_reports_status_idx
  on public.tester_feedback_reports (status);

create index if not exists tester_feedback_reports_club_id_idx
  on public.tester_feedback_reports (club_id);

create index if not exists tester_feedback_reports_submitted_by_user_id_idx
  on public.tester_feedback_reports (submitted_by_user_id);

create or replace function public.set_tester_feedback_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tester_feedback_reports_updated_at on public.tester_feedback_reports;
create trigger set_tester_feedback_reports_updated_at
before update on public.tester_feedback_reports
for each row
execute function public.set_tester_feedback_reports_updated_at();

alter table public.tester_feedback_reports enable row level security;

grant select, insert, update on public.tester_feedback_reports to authenticated;

drop policy if exists tester_feedback_reports_insert_own on public.tester_feedback_reports;
create policy tester_feedback_reports_insert_own
on public.tester_feedback_reports
for insert
to authenticated
with check (
  auth.uid() is not null
  and submitted_by_user_id = auth.uid()
  and status = 'new'
  and resolution_state = ''
  and admin_notes is null
  and (
    current_user_role() = 'super_admin'
    or club_id is null
    or club_id = current_user_club_id()
  )
  and (
    current_user_role() = 'super_admin'
    or team_id is null
    or exists (
      select 1
      from public.teams team
      where team.id = tester_feedback_reports.team_id
        and team.club_id = current_user_club_id()
        and (
          current_user_role() = 'admin'
          or exists (
            select 1
            from public.team_staff staff
            where staff.team_id = team.id
              and staff.user_id = auth.uid()
          )
        )
    )
  )
);

drop policy if exists tester_feedback_reports_select_scoped on public.tester_feedback_reports;
create policy tester_feedback_reports_select_scoped
on public.tester_feedback_reports
for select
to authenticated
using (
  current_user_role() = 'super_admin'
  or submitted_by_user_id = auth.uid()
  or (
    current_user_role() = 'admin'
    and club_id = current_user_club_id()
  )
);

drop policy if exists tester_feedback_reports_update_platform_admin on public.tester_feedback_reports;
create policy tester_feedback_reports_update_platform_admin
on public.tester_feedback_reports
for update
to authenticated
using (current_user_role() = 'super_admin')
with check (current_user_role() = 'super_admin');
