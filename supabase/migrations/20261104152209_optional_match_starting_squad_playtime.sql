create table public.match_day_starting_squads (
  match_day_id uuid primary key references public.match_days(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  board_id uuid not null references public.formation_boards(id) on delete cascade,
  board_version_id uuid not null references public.formation_board_versions(id) on delete cascade,
  player_ids uuid[] not null,
  submitted_by uuid not null references public.users(id),
  submitted_at timestamptz not null default now(),
  constraint match_day_starting_squads_nonempty check (cardinality(player_ids) > 0)
);

create index match_day_starting_squads_team_idx on public.match_day_starting_squads(team_id, match_day_id);
alter table public.match_day_starting_squads enable row level security;
revoke all on public.match_day_starting_squads from public, anon, authenticated;
grant select on public.match_day_starting_squads to authenticated, service_role;
create policy match_day_starting_squads_staff_read on public.match_day_starting_squads
  for select to authenticated using (
    public.can_manage_match_day(team_id)
  );

create or replace function public.submit_match_day_starting_squad(target_match_day_id uuid, target_board_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  fixture public.match_days%rowtype;
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  starters uuid[];
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'starting_squad_auth_required';
  end if;
  select * into fixture from public.match_days
  where id = target_match_day_id and deleted_at is null for update;
  if fixture.id is null or fixture.status in ('cancelled', 'postponed') then
    raise exception using errcode = '22023', message = 'starting_squad_match_invalid';
  end if;
  if fixture.timer_status <> 'not_started' or fixture.status not in ('scheduled', 'scorer_request') then
    raise exception using errcode = '55000', message = 'starting_squad_match_already_started';
  end if;
  select * into board from public.formation_boards
  where id = target_board_id and linked_match_day_id = fixture.id
    and club_id = fixture.club_id and team_id = fixture.team_id
    and deleted_at is null and archived_at is null;
  if board.id is null or not app_private.formation_board_can_edit(auth.uid(), board.id) then
    raise exception using errcode = '42501', message = 'starting_squad_board_forbidden';
  end if;
  select * into version from public.formation_board_versions where id = board.current_version_id and board_id = board.id;
  select array_agg((placement->>'playerId')::uuid order by ordinality)
    into starters from jsonb_array_elements(version.placements) with ordinality as placed(placement, ordinality);
  if coalesce(cardinality(starters), 0) = 0 then
    raise exception using errcode = '22023', message = 'starting_squad_empty_pitch';
  end if;
  insert into public.match_day_starting_squads
    (match_day_id, club_id, team_id, board_id, board_version_id, player_ids, submitted_by)
  values (fixture.id, fixture.club_id, fixture.team_id, board.id, version.id, starters, auth.uid())
  on conflict (match_day_id) do update set
    board_id = excluded.board_id, board_version_id = excluded.board_version_id,
    player_ids = excluded.player_ids, submitted_by = excluded.submitted_by, submitted_at = now();
  return jsonb_build_object('matchDayId', fixture.id, 'boardId', board.id,
    'boardVersionId', version.id, 'playerIds', starters);
end;
$$;

revoke all on function public.submit_match_day_starting_squad(uuid, uuid) from public, anon, service_role;
grant execute on function public.submit_match_day_starting_squad(uuid, uuid) to authenticated;
