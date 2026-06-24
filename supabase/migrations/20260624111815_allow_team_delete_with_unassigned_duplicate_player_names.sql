drop index if exists public.players_club_team_section_player_name_key;

create unique index players_club_team_section_player_name_key
on public.players using btree (club_id, team_id, section, player_name);
