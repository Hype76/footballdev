-- The read RPC calls an authority helper that takes row locks. Marking the
-- wrapper STABLE makes PostgreSQL reject that safe authority check.
alter function public.get_team_carpool_default(uuid) volatile;

update public.formation_board_presets
set display_name = '2-1-1'
where registry_version = 1
  and preset_key = '5v5-1-2-1'
  and display_name = '1-2-1';
