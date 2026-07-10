-- Keep legacy neutral fixtures readable while making new fixture writes Home or Away only.
alter table public.match_days
  add column if not exists match_duration_minutes integer;

update public.match_days
set match_duration_minutes = 90
where match_duration_minutes is null;

alter table public.match_days
  alter column match_duration_minutes set default 90,
  alter column match_duration_minutes set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_days_match_duration_minutes_check'
      and conrelid = 'public.match_days'::regclass
  ) then
    alter table public.match_days
      add constraint match_days_match_duration_minutes_check
      check (
        match_duration_minutes between 20 and 140
        and mod(match_duration_minutes, 2) = 0
      );
  end if;
end;
$$;

create or replace function public.enforce_new_match_day_home_away()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.home_away is null or new.home_away not in ('home', 'away') then
    raise exception 'New fixtures must be Home or Away.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists match_days_new_home_away_only on public.match_days;

create trigger match_days_new_home_away_only
before insert or update of home_away on public.match_days
for each row
execute function public.enforce_new_match_day_home_away();

revoke all on function public.enforce_new_match_day_home_away() from public;
revoke execute on function public.enforce_new_match_day_home_away() from anon, authenticated;

create or replace function public.enforce_match_day_second_half_floor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'second_half'
    and (old.status = 'half_time' or old.timer_status = 'half_time') then
    new.timer_elapsed_seconds := greatest(
      coalesce(new.timer_elapsed_seconds, 0),
      (coalesce(new.match_duration_minutes, 90) / 2) * 60
    );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_match_day_second_half_floor() from public;
revoke execute on function public.enforce_match_day_second_half_floor() from anon, authenticated;
