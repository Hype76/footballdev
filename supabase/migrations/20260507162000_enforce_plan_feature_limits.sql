create or replace function public.can_use_plan_feature(target_club_id uuid, feature_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null then
    return false;
  end if;

  if target_is_plan_comped or target_plan_key = 'large_club' then
    return true;
  end if;

  return case feature_name
    when 'pdf_export' then target_plan_key in ('single_team', 'small_club')
    when 'parent_email' then target_plan_key in ('single_team', 'small_club')
    when 'custom_form_fields' then target_plan_key in ('single_team', 'small_club')
    when 'basic_branding' then target_plan_key in ('single_team', 'small_club')
    when 'custom_branding' then target_plan_key = 'small_club'
    when 'themes' then target_plan_key = 'small_club'
    when 'audit_logs' then target_plan_key = 'small_club'
    when 'approval_workflow' then target_plan_key = 'small_club'
    else false
  end;
end;
$$;

create or replace function public.can_insert_player_for_plan(
  target_club_id uuid,
  target_section text,
  target_player_name text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_player_count integer := 0;
  player_limit integer;
  target_plan_key text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null then
    return false;
  end if;

  if exists (
    select 1
    from public.players
    where club_id = target_club_id
      and section = target_section
      and lower(player_name) = lower(target_player_name)
      and coalesce(status, 'active') <> 'archived'
  ) then
    return true;
  end if;

  if target_is_plan_comped or target_plan_key in ('small_club', 'large_club') then
    return true;
  end if;

  player_limit := case target_plan_key
    when 'individual' then 5
    when 'single_team' then 20
    else 20
  end;

  select count(*)
  into existing_player_count
  from public.players
  where club_id = target_club_id
    and coalesce(status, 'active') <> 'archived';

  return existing_player_count < player_limit;
end;
$$;

create or replace function public.can_insert_evaluation_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_evaluation_count integer := 0;
  target_plan_key text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null then
    return false;
  end if;

  if target_is_plan_comped or target_plan_key <> 'individual' then
    return true;
  end if;

  select count(*)
  into existing_evaluation_count
  from public.evaluations
  where club_id = target_club_id
    and created_at >= date_trunc('month', now());

  return existing_evaluation_count < 10;
end;
$$;

create or replace function public.can_insert_staff_invite_for_plan(target_club_id uuid, target_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  access_email_count integer := 0;
  staff_limit integer;
  target_plan_key text;
  target_is_plan_comped boolean;
  normalized_email text := lower(trim(coalesce(target_email, '')));
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or normalized_email = '' then
    return false;
  end if;

  if exists (
    select 1
    from public.users
    where club_id = target_club_id
      and lower(email) = normalized_email
  ) or exists (
    select 1
    from public.club_user_invites
    where club_id = target_club_id
      and lower(email) = normalized_email
      and accepted_at is null
  ) then
    return true;
  end if;

  if target_is_plan_comped or target_plan_key in ('small_club', 'large_club') then
    return true;
  end if;

  staff_limit := case target_plan_key
    when 'individual' then 1
    when 'single_team' then 3
    else 3
  end;

  select count(distinct email)
  into access_email_count
  from (
    select lower(email) as email
    from public.users
    where club_id = target_club_id
    union
    select lower(email) as email
    from public.club_user_invites
    where club_id = target_club_id
      and accepted_at is null
  ) access_emails;

  return access_email_count < staff_limit;
end;
$$;

revoke all on function public.can_use_plan_feature(uuid, text) from public;
revoke all on function public.can_insert_player_for_plan(uuid, text, text) from public;
revoke all on function public.can_insert_evaluation_for_plan(uuid) from public;
revoke all on function public.can_insert_staff_invite_for_plan(uuid, text) from public;

grant execute on function public.can_use_plan_feature(uuid, text) to authenticated;
grant execute on function public.can_insert_player_for_plan(uuid, text, text) to authenticated;
grant execute on function public.can_insert_evaluation_for_plan(uuid) to authenticated;
grant execute on function public.can_insert_staff_invite_for_plan(uuid, text) to authenticated;

drop policy if exists players_insert_scoped on public.players;
create policy players_insert_scoped
on public.players
for insert
to authenticated
with check (
  public.current_user_role() <> 'super_admin'
  and players.club_id = public.current_user_club_id()
  and public.can_insert_player_for_plan(players.club_id, players.section, players.player_name)
);

drop policy if exists evaluations_insert_scoped on public.evaluations;
create policy evaluations_insert_scoped
on public.evaluations
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and public.can_insert_evaluation_for_plan(evaluations.club_id)
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
    )
  )
);

drop policy if exists club_user_invites_insert_scoped on public.club_user_invites;
create policy club_user_invites_insert_scoped
on public.club_user_invites
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_user_invites.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and club_user_invites.role_rank <= public.current_user_role_rank()
    and public.can_insert_staff_invite_for_plan(club_user_invites.club_id, club_user_invites.email)
  )
);

drop policy if exists form_fields_insert_scoped on public.form_fields;
create policy form_fields_insert_scoped
on public.form_fields
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'super_admin'
    and form_fields.club_id is not null
  )
  or (
    public.current_user_role_rank() >= 50
    and form_fields.club_id = public.current_user_club_id()
    and (
      coalesce(form_fields.is_default, false) = true
      or public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    )
  )
);

drop policy if exists form_fields_update_scoped on public.form_fields;
create policy form_fields_update_scoped
on public.form_fields
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 50
    and form_fields.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 50
    and form_fields.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
  )
);

drop policy if exists form_fields_delete_scoped on public.form_fields;
create policy form_fields_delete_scoped
on public.form_fields
for delete
to authenticated
using (
  form_fields.is_default = false
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role_rank() >= 50
      and form_fields.club_id = public.current_user_club_id()
      and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    )
  )
);

drop policy if exists audit_logs_select_scoped on public.audit_logs;
create policy audit_logs_select_scoped
on public.audit_logs
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.can_use_plan_feature(audit_logs.club_id, 'audit_logs')
    and (
      audit_logs.actor_id = auth.uid()
      or (
        audit_logs.club_id = public.current_user_club_id()
        and public.current_user_role_rank() >= 50
        and coalesce(audit_logs.actor_role_rank, 0) <= public.current_user_role_rank()
      )
    )
  )
);

create or replace function public.enforce_club_plan_update_features()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_user_role() = 'super_admin' then
    return new;
  end if;

  if old.logo_url is distinct from new.logo_url
    and not public.can_use_plan_feature(new.id, 'basic_branding') then
    raise exception 'Logo branding is not included in this plan.';
  end if;

  if old.require_approval is distinct from new.require_approval
    and not public.can_use_plan_feature(new.id, 'approval_workflow') then
    raise exception 'Approval workflow is not included in this plan.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_club_plan_update_features on public.clubs;
create trigger enforce_club_plan_update_features
before update on public.clubs
for each row
execute function public.enforce_club_plan_update_features();

create or replace function public.enforce_user_plan_update_features()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_user_role() = 'super_admin' then
    return new;
  end if;

  if (old.theme_mode is distinct from new.theme_mode or old.theme_accent is distinct from new.theme_accent)
    and not public.can_use_plan_feature(new.club_id, 'themes') then
    raise exception 'Theme preferences are not included in this plan.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_user_plan_update_features on public.users;
create trigger enforce_user_plan_update_features
before update on public.users
for each row
execute function public.enforce_user_plan_update_features();
