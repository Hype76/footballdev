create or replace function public.revoke_parent_links_for_archived_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' then
    update public.parent_player_links link
    set
      status = 'revoked',
      auth_user_id = null,
      accepted_at = null,
      updated_at = timezone('utc', now())
    where link.player_id = new.id
      and link.status <> 'revoked';
  end if;

  return new;
end;
$$;

drop trigger if exists revoke_parent_links_on_player_archive on public.players;
create trigger revoke_parent_links_on_player_archive
after update of status on public.players
for each row
execute function public.revoke_parent_links_for_archived_player();
