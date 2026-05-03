alter table public.users
add column if not exists theme_mode text;

alter table public.users
add column if not exists theme_accent text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_theme_mode_check'
  ) then
    alter table public.users
    add constraint users_theme_mode_check
    check (theme_mode is null or theme_mode in ('system', 'dark', 'light'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_theme_accent_check'
  ) then
    alter table public.users
    add constraint users_theme_accent_check
    check (theme_accent is null or theme_accent in ('yellow', 'blue', 'green', 'red', 'purple'));
  end if;
end $$;
