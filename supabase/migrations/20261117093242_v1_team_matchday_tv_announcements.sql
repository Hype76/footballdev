alter table public.teams
  add column tv_public_announcements boolean not null default true,
  add column tv_goal_celebrations boolean not null default true;

comment on column public.teams.tv_public_announcements is
  'Show this team''s scores and results on Matchday TV.';
comment on column public.teams.tv_goal_celebrations is
  'Allow goal pop-ups on Matchday TV when public announcements are enabled.';

create function app_private.enforce_team_tv_settings_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if not new.tv_public_announcements or not new.tv_goal_celebrations then
        raise exception 'team_tv_settings_require_managed_write' using errcode = '42501';
      end if;
    elsif new.tv_public_announcements is distinct from old.tv_public_announcements
      or new.tv_goal_celebrations is distinct from old.tv_goal_celebrations then
      raise exception 'team_tv_settings_require_managed_write' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_team_tv_settings_authority() from public, anon, authenticated;
create trigger enforce_team_tv_settings_authority
  before insert or update of tv_public_announcements, tv_goal_celebrations on public.teams
  for each row execute function app_private.enforce_team_tv_settings_authority();
