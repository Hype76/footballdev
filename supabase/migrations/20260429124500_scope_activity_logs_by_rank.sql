alter table public.audit_logs
  add column if not exists actor_role_label text,
  add column if not exists actor_role_rank integer not null default 0;

alter table public.record_backups
  add column if not exists actor_role_label text,
  add column if not exists actor_role_rank integer not null default 0;

update public.audit_logs log
set
  actor_role_label = coalesce(nullif(log.actor_role_label, ''), users.role_label, users.role, ''),
  actor_role_rank = coalesce(nullif(log.actor_role_rank, 0), users.role_rank, 0)
from public.users
where log.actor_id = users.id;

update public.record_backups backup
set
  actor_role_label = coalesce(nullif(backup.actor_role_label, ''), users.role_label, users.role, ''),
  actor_role_rank = coalesce(nullif(backup.actor_role_rank, 0), users.role_rank, 0)
from public.users
where backup.actor_id = users.id;

create index if not exists audit_logs_club_actor_rank_created_idx
on public.audit_logs (club_id, actor_role_rank, created_at desc);

create index if not exists record_backups_club_actor_rank_created_idx
on public.record_backups (club_id, actor_role_rank, created_at desc);

drop policy if exists audit_logs_select_scoped on public.audit_logs;
create policy audit_logs_select_scoped
on public.audit_logs
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or audit_logs.actor_id = auth.uid()
  or (
    audit_logs.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and coalesce(audit_logs.actor_role_rank, 0) <= public.current_user_role_rank()
  )
);

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
    and coalesce(record_backups.actor_role_rank, 0) <= public.current_user_role_rank()
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
  backup_actor_role_label text;
  backup_actor_role_rank integer;
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

  select coalesce(users.role_label, users.role, ''), coalesce(users.role_rank, 0)
  into backup_actor_role_label, backup_actor_role_rank
  from public.users
  where users.id = auth.uid();

  insert into public.record_backups (
    club_id,
    table_name,
    record_id,
    operation,
    actor_id,
    actor_role_label,
    actor_role_rank,
    old_data,
    new_data
  )
  values (
    backup_club_id,
    TG_TABLE_NAME,
    backup_record_id,
    TG_OP,
    auth.uid(),
    backup_actor_role_label,
    coalesce(backup_actor_role_rank, 0),
    old_record,
    new_record
  );

  return coalesce(NEW, OLD);
end;
$$;
