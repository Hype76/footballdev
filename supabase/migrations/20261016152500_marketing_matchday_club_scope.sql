-- Public, aggregate-only Match Day figures for the Football Player website.
-- The legacy clubs table stores every workspace, including standalone teams.
create extension if not exists pg_cron;

create schema if not exists app_private;

create table if not exists public.marketing_matchday_stats (
  id boolean primary key default true check (id),
  matches_recorded bigint not null default 0,
  goals_recorded bigint not null default 0,
  alerts_sent bigint not null default 0,
  teams_active bigint not null default 0,
  clubs_active bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.marketing_matchday_stats enable row level security;
revoke all on public.marketing_matchday_stats from public, anon, authenticated;
grant select on public.marketing_matchday_stats to anon, authenticated;

drop policy if exists marketing_matchday_stats_read on public.marketing_matchday_stats;
create policy marketing_matchday_stats_read on public.marketing_matchday_stats
  for select to anon, authenticated using (id = true);

create or replace function app_private.refresh_marketing_matchday_stats()
returns void
language sql
security definer
set search_path = pg_catalog
as $function$
  insert into public.marketing_matchday_stats (
    id, matches_recorded, goals_recorded, alerts_sent,
    teams_active, clubs_active, updated_at
  )
  select
    true,
    (select count(*) from public.match_days m
      where m.status = 'full_time' and m.deleted_at is null),
    (select count(*) from public.match_day_events e
      join public.match_days m on m.id = e.match_day_id
      where e.event_type = 'goal' and e.event_status = 'active'
        and m.deleted_at is null),
    (select count(*) from public.parent_mobile_notification_events n
      where n.intent_type = 'matchday_update' and n.status = 'sent')
    + (select count(*) from public.fan_notifications f
      where f.match_id is not null and f.push_sent_at is not null),
    (select count(*) from public.teams t
      join public.clubs c on c.id = t.club_id
      where t.status = 'active' and t.archived_at is null
        and c.status = 'active' and c.archived_at is null),
    (select count(*) from public.clubs c
      where c.status = 'active' and c.archived_at is null
        and c.plan_key in ('club', 'small_club', 'development_club', 'large_club')),
    now()
  on conflict (id) do update set
    matches_recorded = excluded.matches_recorded,
    goals_recorded = excluded.goals_recorded,
    alerts_sent = excluded.alerts_sent,
    teams_active = excluded.teams_active,
    clubs_active = excluded.clubs_active,
    updated_at = excluded.updated_at;
$function$;

revoke all on function app_private.refresh_marketing_matchday_stats()
  from public, anon, authenticated;

create or replace function app_private.refresh_marketing_matchday_stats_if_due()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  local_now timestamp := now() at time zone 'Europe/London';
begin
  if extract(isodow from local_now) in (6, 7)
    or (extract(hour from local_now)::integer % 4 = 0
        and extract(minute from local_now) = 0) then
    perform app_private.refresh_marketing_matchday_stats();
  end if;
end;
$function$;

revoke all on function app_private.refresh_marketing_matchday_stats_if_due()
  from public, anon, authenticated;

select app_private.refresh_marketing_matchday_stats();

select cron.schedule(
  'marketing-matchday-stats',
  '*/15 * * * *',
  'select app_private.refresh_marketing_matchday_stats_if_due();'
);
