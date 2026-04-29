create table if not exists public.record_backups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid,
  table_name text not null,
  record_id uuid,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid references public.users (id) on delete set null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists record_backups_club_created_idx
on public.record_backups (club_id, created_at desc);

create index if not exists record_backups_table_record_idx
on public.record_backups (table_name, record_id, created_at desc);

grant select on public.record_backups to authenticated;

alter table public.record_backups enable row level security;

drop policy if exists record_backups_select_scoped on public.record_backups;
create policy record_backups_select_scoped
on public.record_backups
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    record_backups.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

create or replace function public.capture_record_backup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_record jsonb;
  new_record jsonb;
  record_data jsonb;
  backup_club_id uuid;
  backup_record_id uuid;
begin
  old_record := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end;
  new_record := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end;
  record_data := coalesce(new_record, old_record);

  begin
    backup_record_id := nullif(record_data ->> 'id', '')::uuid;
  exception when others then
    backup_record_id := null;
  end;

  begin
    backup_club_id := nullif(record_data ->> 'club_id', '')::uuid;
  exception when others then
    backup_club_id := null;
  end;

  if backup_club_id is null and TG_TABLE_NAME = 'clubs' then
    backup_club_id := backup_record_id;
  end if;

  if backup_club_id is null and TG_TABLE_NAME = 'team_staff' then
    select t.club_id
    into backup_club_id
    from public.teams t
    where t.id = nullif(record_data ->> 'team_id', '')::uuid;
  end if;

  if backup_club_id is null and TG_TABLE_NAME = 'assessment_session_players' then
    select s.club_id
    into backup_club_id
    from public.assessment_sessions s
    where s.id = nullif(record_data ->> 'session_id', '')::uuid;
  end if;

  insert into public.record_backups (
    club_id,
    table_name,
    record_id,
    operation,
    actor_id,
    old_data,
    new_data
  )
  values (
    backup_club_id,
    TG_TABLE_NAME,
    backup_record_id,
    TG_OP,
    auth.uid(),
    old_record,
    new_record
  );

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists backup_clubs on public.clubs;
create trigger backup_clubs
after insert or update or delete on public.clubs
for each row execute function public.capture_record_backup();

drop trigger if exists backup_users on public.users;
create trigger backup_users
after insert or update or delete on public.users
for each row execute function public.capture_record_backup();

drop trigger if exists backup_user_club_memberships on public.user_club_memberships;
create trigger backup_user_club_memberships
after insert or update or delete on public.user_club_memberships
for each row execute function public.capture_record_backup();

drop trigger if exists backup_club_user_invites on public.club_user_invites;
create trigger backup_club_user_invites
after insert or update or delete on public.club_user_invites
for each row execute function public.capture_record_backup();

drop trigger if exists backup_teams on public.teams;
create trigger backup_teams
after insert or update or delete on public.teams
for each row execute function public.capture_record_backup();

drop trigger if exists backup_team_staff on public.team_staff;
create trigger backup_team_staff
after insert or update or delete on public.team_staff
for each row execute function public.capture_record_backup();

drop trigger if exists backup_players on public.players;
create trigger backup_players
after insert or update or delete on public.players
for each row execute function public.capture_record_backup();

drop trigger if exists backup_evaluations on public.evaluations;
create trigger backup_evaluations
after insert or update or delete on public.evaluations
for each row execute function public.capture_record_backup();

drop trigger if exists backup_assessment_sessions on public.assessment_sessions;
create trigger backup_assessment_sessions
after insert or update or delete on public.assessment_sessions
for each row execute function public.capture_record_backup();

drop trigger if exists backup_assessment_session_players on public.assessment_session_players;
create trigger backup_assessment_session_players
after insert or update or delete on public.assessment_session_players
for each row execute function public.capture_record_backup();

drop trigger if exists backup_form_fields on public.form_fields;
create trigger backup_form_fields
after insert or update or delete on public.form_fields
for each row execute function public.capture_record_backup();

drop trigger if exists backup_platform_feedback on public.platform_feedback;
create trigger backup_platform_feedback
after insert or update or delete on public.platform_feedback
for each row execute function public.capture_record_backup();
