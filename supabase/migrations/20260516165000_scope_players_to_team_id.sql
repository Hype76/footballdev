alter table public.players
  add column if not exists team_id uuid references public.teams (id) on delete set null;

update public.players p
set team_id = t.id
from public.teams t
where p.team_id is null
  and t.club_id = p.club_id
  and lower(t.name) = lower(p.team);

drop index if exists public.players_club_section_name_key;
drop index if exists public.players_club_section_player_name_key;

create unique index if not exists players_club_team_section_player_name_key
on public.players (club_id, team_id, section, player_name) nulls not distinct;

create index if not exists players_club_team_idx
on public.players (club_id, team_id);

create index if not exists players_team_id_idx
on public.players (team_id);
