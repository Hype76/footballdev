create table if not exists public.match_day_final_reports (
  match_day_id uuid primary key references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  staff_notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_day_final_reports_staff_notes_length_check
    check (char_length(staff_notes) <= 5000)
);

create index if not exists match_day_final_reports_club_team_idx
on public.match_day_final_reports (club_id, team_id, updated_at desc);

alter table public.match_day_final_reports enable row level security;

revoke all on public.match_day_final_reports from public;
revoke all on public.match_day_final_reports from anon;
revoke all on public.match_day_final_reports from authenticated;
grant select on public.match_day_final_reports to authenticated;
grant all on public.match_day_final_reports to service_role;

drop policy if exists match_day_final_reports_staff_select_scoped on public.match_day_final_reports;
create policy match_day_final_reports_staff_select_scoped
on public.match_day_final_reports
for select
to authenticated
using (
  coalesce(public.current_user_role(), '') not in ('admin', 'parent_portal', 'super_admin')
  and coalesce(public.current_user_role_rank(), 0) >= 20
  and club_id = public.current_user_club_id()
  and exists (
    select 1
    from public.match_days match_day
    where match_day.id = match_day_final_reports.match_day_id
      and match_day.club_id = match_day_final_reports.club_id
      and match_day.team_id is not distinct from match_day_final_reports.team_id
      and match_day.status = 'full_time'
      and public.can_read_match_day(match_day.team_id)
  )
);

create or replace function public.save_match_day_final_report(
  match_day_id_value uuid,
  staff_notes_value text default ''
)
returns public.match_day_final_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.match_days%rowtype;
  report_row public.match_day_final_reports%rowtype;
  normalized_staff_notes text := btrim(coalesce(staff_notes_value, ''));
  actor_name text;
begin
  if auth.uid() is null then
    raise exception 'Login is required before saving a final match report.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value;

  if not found then
    raise exception 'This match could not be found.';
  end if;

  if match_row.status <> 'full_time' then
    raise exception 'The final match report is available after full time.';
  end if;

  if match_row.club_id is distinct from public.current_user_club_id()
    or coalesce(public.current_user_role(), '') in ('admin', 'parent_portal', 'super_admin')
    or coalesce(public.current_user_role_rank(), 0) < 20
    or not coalesce(public.can_read_match_day(match_row.team_id), false)
  then
    raise exception 'You do not have access to this final match report.';
  end if;

  if char_length(normalized_staff_notes) > 5000 then
    raise exception 'Staff notes must be 5000 characters or fewer.';
  end if;

  select coalesce(nullif(btrim(profile.name), ''), nullif(btrim(profile.email), ''), 'Staff member')
  into actor_name
  from public.users profile
  where profile.id = auth.uid();

  actor_name := coalesce(actor_name, 'Staff member');

  insert into public.match_day_final_reports (
    match_day_id,
    club_id,
    team_id,
    staff_notes,
    created_by,
    created_by_name,
    updated_by,
    updated_by_name
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    normalized_staff_notes,
    auth.uid(),
    actor_name,
    auth.uid(),
    actor_name
  )
  on conflict (match_day_id) do update
  set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    staff_notes = excluded.staff_notes,
    updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name,
    updated_at = timezone('utc', now())
  returning * into report_row;

  return report_row;
end;
$$;

revoke all on function public.save_match_day_final_report(uuid, text) from public;
revoke execute on function public.save_match_day_final_report(uuid, text) from anon;
grant execute on function public.save_match_day_final_report(uuid, text) to authenticated, service_role;
