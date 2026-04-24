create or replace function public.clear_own_force_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set force_password_change = false
  where id = auth.uid();
end;
$$;

revoke all on function public.clear_own_force_password_change() from public;
grant execute on function public.clear_own_force_password_change() to authenticated;
