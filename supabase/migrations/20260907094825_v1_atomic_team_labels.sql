-- Keep legacy display labels consistent in the same transaction as a team rename.
-- Existing team UPDATE authority and billing triggers remain the entry boundary.
create or replace function public.sync_renamed_team_labels_internal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is not distinct from old.name then return new; end if;
  update public.players
  set team = new.name
  where club_id = new.club_id
    and (team_id = new.id or (team_id is null and team = old.name
      and not exists (select 1 from public.teams other where other.club_id = old.club_id and other.id <> old.id and other.name = old.name)));
  update public.evaluations
  set team = new.name
  where club_id = new.club_id
    and (team_id = new.id or (team_id is null and team = old.name
      and not exists (select 1 from public.teams other where other.club_id = old.club_id and other.id <> old.id and other.name = old.name)));
  return new;
end;
$$;
revoke all on function public.sync_renamed_team_labels_internal() from public, anon, authenticated, service_role;
create trigger sync_renamed_team_labels
  after update of name on public.teams
  for each row execute function public.sync_renamed_team_labels_internal();
