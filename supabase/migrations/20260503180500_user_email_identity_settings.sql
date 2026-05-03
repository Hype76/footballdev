alter table public.users
add column if not exists display_name text;

alter table public.users
add column if not exists team_name text;

alter table public.users
add column if not exists club_name text;

alter table public.users
add column if not exists reply_to_email text;

update public.users
set display_name = nullif(trim(coalesce(display_name, username, name, split_part(email, '@', 1))), '')
where display_name is null;

update public.users
set reply_to_email = nullif(trim(coalesce(reply_to_email, email)), '')
where reply_to_email is null;
