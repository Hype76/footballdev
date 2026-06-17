revoke all on function public.get_end_season_stats(uuid) from public;
revoke execute on function public.get_end_season_stats(uuid) from anon;
grant execute on function public.get_end_season_stats(uuid) to authenticated;
grant execute on function public.get_end_season_stats(uuid) to service_role;
