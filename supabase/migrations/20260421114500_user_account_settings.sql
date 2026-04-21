alter table public.users
add column if not exists username text;

update public.users
set username = nullif(trim(coalesce(username, name, split_part(email, '@', 1))), '')
where username is null;

create index if not exists users_username_idx
on public.users (lower(username));
