drop policy if exists team_logos_manager_insert on storage.objects;
drop policy if exists team_logos_manager_update on storage.objects;
drop policy if exists team_logos_manager_delete on storage.objects;

alter table public.teams
  drop column if exists logo_url;
