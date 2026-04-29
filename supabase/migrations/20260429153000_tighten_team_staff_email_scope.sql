delete from public.team_staff duplicate_staff
using public.team_staff kept_staff
join public.users kept_user
  on kept_user.id = kept_staff.user_id,
public.users duplicate_user
where duplicate_staff.team_id = kept_staff.team_id
  and duplicate_user.id = duplicate_staff.user_id
  and lower(coalesce(duplicate_user.email, '')) = lower(coalesce(kept_user.email, ''))
  and duplicate_staff.id > kept_staff.id;

create or replace function public.prevent_duplicate_team_staff_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_user_email text;
begin
  select lower(coalesce(email, ''))
  into new_user_email
  from public.users
  where id = new.user_id;

  if new_user_email = '' then
    return new;
  end if;

  if exists (
    select 1
    from public.team_staff existing_staff
    join public.users existing_user
      on existing_user.id = existing_staff.user_id
    where existing_staff.team_id = new.team_id
      and existing_staff.user_id <> new.user_id
      and lower(coalesce(existing_user.email, '')) = new_user_email
  ) then
    raise exception 'This email already has access to this team.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_team_staff_email_trigger on public.team_staff;
create trigger prevent_duplicate_team_staff_email_trigger
before insert or update on public.team_staff
for each row
execute function public.prevent_duplicate_team_staff_email();

drop policy if exists users_delete_lower_role_manager on public.users;
create policy users_delete_lower_role_manager
on public.users
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
    and coalesce(users.role_rank, 0) <= public.current_user_role_rank()
    and users.id <> auth.uid()
  )
);
