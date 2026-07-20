-- FP-V1-SECURITY-P0-AUTHORITY-CONTAINMENT-RECOVERY-BACKUP-SIDE-EFFECT-IMPLEMENT-01
-- Prevents the approved atomic public-demo recovery transaction from creating
-- record_backups rows. Existing backup and audit rows are not modified.

create schema if not exists app_private authorization postgres;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
revoke all on schema app_private from authenticated;
revoke all on schema app_private from service_role;

create table app_private.demo_reset_backup_context (
  backend_pid integer not null,
  transaction_id bigint not null,
  context_nonce uuid not null,
  operation_id uuid not null,
  actor_id uuid not null,
  club_id uuid not null,
  demo_scope text not null check (demo_scope = 'public-demo-v1'),
  primary key (backend_pid, transaction_id)
);

alter table app_private.demo_reset_backup_context enable row level security;

revoke all on table app_private.demo_reset_backup_context from public;
revoke all on table app_private.demo_reset_backup_context from anon;
revoke all on table app_private.demo_reset_backup_context from authenticated;
revoke all on table app_private.demo_reset_backup_context from service_role;

alter function public."reset_demo_account_atomic"(uuid, uuid)
rename to "reset_demo_account_atomic_impl";

create function public."reset_demo_account_atomic"(
  p_actor_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid;
  v_context_nonce uuid := gen_random_uuid();
  v_transaction_id bigint := pg_catalog.txid_current();
  v_result jsonb;
begin
  if p_actor_id is null or p_operation_id is null then
    raise exception using errcode = '22023', message = 'DEMO_SCOPE_INVALID_ARGUMENT';
  end if;

  select club.id
  into v_club_id
  from public.clubs club
  where lower(club.name) = lower('Cambourne Town Academy FC');

  if v_club_id is null then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_CLUB_MISSING';
  end if;

  insert into app_private.demo_reset_backup_context (
    backend_pid,
    transaction_id,
    context_nonce,
    operation_id,
    actor_id,
    club_id,
    demo_scope
  ) values (
    pg_catalog.pg_backend_pid(),
    v_transaction_id,
    v_context_nonce,
    p_operation_id,
    p_actor_id,
    v_club_id,
    'public-demo-v1'
  );

  perform pg_catalog.set_config(
    'app.demo_reset_backup_context_nonce',
    v_context_nonce::text,
    true
  );

  begin
    v_result := public."reset_demo_account_atomic_impl"(p_actor_id, p_operation_id);
  exception when others then
    delete from app_private.demo_reset_backup_context context
    where context.backend_pid = pg_catalog.pg_backend_pid()
      and context.transaction_id = v_transaction_id
      and context.context_nonce = v_context_nonce;
    perform pg_catalog.set_config('app.demo_reset_backup_context_nonce', '', true);
    raise;
  end;

  delete from app_private.demo_reset_backup_context context
  where context.backend_pid = pg_catalog.pg_backend_pid()
    and context.transaction_id = v_transaction_id
    and context.context_nonce = v_context_nonce;
  perform pg_catalog.set_config('app.demo_reset_backup_context_nonce', '', true);

  return v_result;
end;
$$;

revoke all on function public."reset_demo_account_atomic_impl"(uuid, uuid) from public;
revoke all on function public."reset_demo_account_atomic_impl"(uuid, uuid) from anon;
revoke all on function public."reset_demo_account_atomic_impl"(uuid, uuid) from authenticated;
revoke all on function public."reset_demo_account_atomic_impl"(uuid, uuid) from service_role;

revoke all on function public."reset_demo_account_atomic"(uuid, uuid) from public;
revoke all on function public."reset_demo_account_atomic"(uuid, uuid) from anon;
revoke all on function public."reset_demo_account_atomic"(uuid, uuid) from authenticated;
grant execute on function public."reset_demo_account_atomic"(uuid, uuid) to service_role;

comment on schema app_private is
  'Internal database-only state. This schema is not part of the Data API.';

comment on table app_private.demo_reset_backup_context is
  'Transient protected context for the current atomic demo recovery transaction. Successful execution removes its row and rollback removes it automatically.';

comment on function public."reset_demo_account_atomic_impl"(uuid, uuid) is
  'Internal implementation for the atomic public-demo recovery. Direct execution is revoked from API roles.';

comment on function public."reset_demo_account_atomic"(uuid, uuid) is
  'Service-role recovery boundary that establishes protected transaction-local backup suppression context.';

create or replace function public.capture_record_backup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_record jsonb;
  new_record jsonb;
  record_data jsonb;
  backup_club_id uuid;
  backup_record_id uuid;
  backup_actor_role_label text;
  backup_actor_role_rank integer;
  recovery_operation_id uuid;
  recovery_actor_id uuid;
  recovery_club_id uuid;
  recovery_context_nonce uuid;
  request_role text;
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
    select team.club_id
    into backup_club_id
    from public.teams team
    where team.id = nullif(record_data ->> 'team_id', '')::uuid;
  end if;

  if backup_club_id is null and TG_TABLE_NAME = 'assessment_session_players' then
    select session.club_id
    into backup_club_id
    from public.assessment_sessions session
    where session.id = nullif(record_data ->> 'session_id', '')::uuid;
  end if;

  request_role := pg_catalog.current_setting('role', true);

  if TG_TABLE_NAME in (
    'team_staff',
    'players',
    'evaluations',
    'form_fields',
    'assessment_sessions',
    'assessment_session_players'
  )
  and pg_catalog.current_setting('app.demo_reset_skip_communication_sync', true) = 'on'
  and request_role = 'service_role'
  then
    begin
      recovery_operation_id := nullif(
        pg_catalog.current_setting('app.demo_reset_operation_id', true),
        ''
      )::uuid;
      recovery_context_nonce := nullif(
        pg_catalog.current_setting('app.demo_reset_backup_context_nonce', true),
        ''
      )::uuid;
    exception when others then
      recovery_operation_id := null;
      recovery_context_nonce := null;
    end;

    if recovery_operation_id is not null
    and recovery_context_nonce is not null
    and backup_club_id is not null
    then
      select context.actor_id, context.club_id
      into recovery_actor_id, recovery_club_id
      from app_private.demo_reset_backup_context context
      where context.backend_pid = pg_catalog.pg_backend_pid()
        and context.transaction_id = pg_catalog.txid_current()
        and context.context_nonce = recovery_context_nonce
        and context.operation_id = recovery_operation_id
        and context.demo_scope = 'public-demo-v1';
    end if;

    if recovery_operation_id is not null
    and recovery_context_nonce is not null
    and recovery_actor_id is not null
    and recovery_club_id = backup_club_id
    and exists (
      select 1
      from public.clubs club
      join public.users app_user on app_user.club_id = club.id
      join auth.users auth_user on auth_user.id = app_user.id
      where club.id = recovery_club_id
        and lower(club.name) = lower('Cambourne Town Academy FC')
        and club.status = 'active'
        and club.plan_key = 'large_club'
        and club.plan_status = 'active'
        and club.is_plan_comped is true
        and lower(auth_user.email) = 'demo@playerfeedback.online'
        and auth_user.id = recovery_actor_id
        and app_user.email is not distinct from auth_user.email
        and app_user.role = 'head_manager'
        and app_user.role_rank = 70
        and app_user.status = 'active'
    )
    and not exists (
      select 1
      from public.demo_reset_operations operation
      where operation.operation_id = recovery_operation_id
        and operation.demo_scope = 'public-demo-v1'
        and operation.outcome = 'completed'
    )
    then
      return coalesce(NEW, OLD);
    end if;
  end if;

  select coalesce(app_user.role_label, app_user.role, ''), coalesce(app_user.role_rank, 0)
  into backup_actor_role_label, backup_actor_role_rank
  from public.users app_user
  where app_user.id = auth.uid();

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

revoke all on function public.capture_record_backup() from public;
revoke all on function public.capture_record_backup() from anon;
revoke all on function public.capture_record_backup() from authenticated;

comment on function public.capture_record_backup() is
  'Captures ordinary row history. Suppression is limited to the service-role atomic public-demo recovery transaction and its exact demo scope.';
