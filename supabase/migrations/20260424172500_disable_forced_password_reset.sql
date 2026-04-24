update public.users
set force_password_change = false
where force_password_change = true;

drop function if exists public.clear_own_force_password_change();
