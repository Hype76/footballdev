alter table public.users
add column if not exists force_password_change boolean not null default false;

update public.users
set force_password_change = false
where force_password_change is null;

create index if not exists users_force_password_change_idx
on public.users (force_password_change);
