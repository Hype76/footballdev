-- Record one durable notification intent per newly saved, authorised kick.
create table private.match_day_shootout_notification_intents (
  kick_id uuid primary key references public.match_day_shootout_kicks(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  completed_at timestamptz,
  last_error text not null default ''
);
alter table private.match_day_shootout_notification_intents enable row level security;
revoke all on private.match_day_shootout_notification_intents from public, anon, authenticated;

create function private.enqueue_match_day_shootout_notification()
returns trigger language plpgsql set search_path='' as $$
begin
  insert into private.match_day_shootout_notification_intents(kick_id)
    values(new.id) on conflict(kick_id) do nothing;
  return new;
end;
$$;
revoke all on function private.enqueue_match_day_shootout_notification() from public, anon, authenticated;
create trigger match_day_shootout_notification_enqueue
after insert on public.match_day_shootout_kicks
for each row execute function private.enqueue_match_day_shootout_notification();

-- Existing Parent apps already request immediate delivery after a saved command.
create function private.mark_parent_shootout_notification_command()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.kind='shootout' and new.event_id is not null then
    new.notification_type:='shootout_kick';
  end if;
  return new;
end;
$$;
revoke all on function private.mark_parent_shootout_notification_command() from public, anon, authenticated;
create trigger parent_shootout_notification_command
before insert on private.parent_scorer_match_day_commands
for each row execute function private.mark_parent_shootout_notification_command();

create function public.claim_match_day_shootout_notifications(
  match_day_id_value uuid default null, kick_id_value uuid default null
)
returns table(kick_id uuid, match_day_id uuid, attempt integer)
language sql security definer set search_path='' as $$
  with eligible as (
    select i.kick_id
    from private.match_day_shootout_notification_intents i
    join public.match_day_shootout_kicks k on k.id=i.kick_id
    join public.match_days m on m.id=k.match_day_id
    where i.completed_at is null and i.attempts<5
      and (i.claimed_at is null or i.claimed_at<now()-interval '2 minutes')
      and i.created_at>now()-interval '4 hours'
      and k.event_status='active' and m.deleted_at is null
      and m.status not in ('cancelled','postponed')
      and (match_day_id_value is null or m.id=match_day_id_value)
      and (kick_id_value is null or k.id=kick_id_value)
      and coalesce(auth.jwt()->>'role','')='service_role'
    order by i.created_at, i.kick_id
    limit 10 for update of i skip locked
  ), claimed as (
    update private.match_day_shootout_notification_intents i
    set claimed_at=now(), attempts=i.attempts+1
    from eligible e where e.kick_id=i.kick_id
    returning i.kick_id, i.attempts, i.created_at
  )
  select c.kick_id,k.match_day_id,c.attempts from claimed c
  join public.match_day_shootout_kicks k on k.id=c.kick_id
  order by c.created_at,c.kick_id;
$$;
revoke all on function public.claim_match_day_shootout_notifications(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_match_day_shootout_notifications(uuid,uuid) to service_role;

create function public.complete_match_day_shootout_notification(
  kick_id_value uuid, attempt_value integer, error_value text default ''
)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then return false; end if;
  update private.match_day_shootout_notification_intents i
  set completed_at=case when coalesce(error_value,'')='' then now() else null end,
      last_error=left(coalesce(error_value,''),500)
  where i.kick_id=kick_id_value and i.attempts=attempt_value and i.completed_at is null;
  return found;
end;
$$;
revoke all on function public.complete_match_day_shootout_notification(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.complete_match_day_shootout_notification(uuid,integer,text) to service_role;
