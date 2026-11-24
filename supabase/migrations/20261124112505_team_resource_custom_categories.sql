-- Keep custom category names inside the team that created them.
create table public.resource_library_categories (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (
    name = btrim(name) and char_length(name) between 1 and 60
    and name !~ '[[:cntrl:]]'
    and lower(name) not in ('general','training','match_day','match day','development','admin','all categories')
  ),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.users(id)
);
create unique index resource_library_categories_team_name_unique
  on public.resource_library_categories(team_id, lower(name));
alter table public.resource_library_categories enable row level security;
revoke all on public.resource_library_categories from public, anon, authenticated;
grant select, insert on public.resource_library_categories to authenticated;
create policy resource_library_categories_view on public.resource_library_categories
  for select to authenticated using (public.current_user_can_view_resource_library(club_id, team_id));
create policy resource_library_categories_create on public.resource_library_categories
  for insert to authenticated with check (
    created_by = auth.uid() and public.current_user_can_manage_resource_library(club_id, team_id)
  );

-- Existing built-in categories keep their exact stored values. Custom values
-- must refer to a category registered for the same club and team.
alter table public.resource_library_items drop constraint resource_library_items_category_check;
alter table public.resource_library_items add constraint resource_library_items_category_check
  check (category = btrim(category) and char_length(category) between 1 and 60 and category !~ '[[:cntrl:]]');

create function private.validate_team_resource_category()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.category not in ('general','training','match_day','development','admin')
    and not exists (
      select 1 from public.resource_library_categories c
      where c.club_id = new.club_id and c.team_id = new.team_id and c.name = new.category
    ) then
    raise exception 'Choose a Resource category registered for this team.';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_team_resource_category() from public, anon, authenticated;
create trigger resource_library_items_validate_category
  before insert or update of category, club_id, team_id on public.resource_library_items
  for each row execute function private.validate_team_resource_category();
