create or replace function public.enforce_player_restore_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_user_role() = 'super_admin' then
    return new;
  end if;

  if coalesce(old.status, 'active') = 'archived'
    and coalesce(new.status, 'active') <> 'archived'
    and not public.can_insert_player_for_plan(new.club_id, new.section, new.player_name) then
    raise exception 'Players are limited on your current plan. Archive or delete another player before restoring this one.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_player_restore_plan_limit on public.players;
create trigger enforce_player_restore_plan_limit
before update on public.players
for each row
execute function public.enforce_player_restore_plan_limit();
