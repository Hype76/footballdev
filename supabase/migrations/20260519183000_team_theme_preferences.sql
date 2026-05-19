alter table public.teams
add column if not exists theme_mode text;

alter table public.teams
add column if not exists theme_accent text;

alter table public.teams
add column if not exists theme_button_style text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_theme_mode_check'
  ) then
    alter table public.teams
    add constraint teams_theme_mode_check
    check (theme_mode is null or theme_mode in ('system', 'dark', 'light'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_theme_accent_check'
  ) then
    alter table public.teams
    add constraint teams_theme_accent_check
    check (theme_accent is null or theme_accent in ('yellow', 'blue', 'green', 'red', 'purple'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_theme_button_style_check'
  ) then
    alter table public.teams
    add constraint teams_theme_button_style_check
    check (theme_button_style is null or theme_button_style in ('solid', 'gradient'));
  end if;
end $$;
