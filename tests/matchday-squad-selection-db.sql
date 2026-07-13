begin;

insert into auth.users (id)
values
  ('30000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000003');

insert into public.clubs (id, name)
values
  ('10000000-0000-4000-8000-000000000001', 'Fixture Club One'),
  ('10000000-0000-4000-8000-000000000002', 'Fixture Club Two');

insert into public.teams (id, club_id, name)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Fixture Team One'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Fixture Team Two'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Fixture Team Three');

insert into public.users (id, email, name, display_name, role, role_label, role_rank, club_id, status)
values
  ('30000000-0000-4000-8000-000000000001', 'coach.fixture@example.test', 'Coach Fixture', 'Coach Fixture', 'coach', 'Coach', 30, '10000000-0000-4000-8000-000000000001', 'active'),
  ('30000000-0000-4000-8000-000000000002', 'parent.fixture@example.test', 'Parent Fixture', 'Parent Fixture', 'parent_portal', 'Parent', 0, '10000000-0000-4000-8000-000000000001', 'active'),
  ('30000000-0000-4000-8000-000000000003', 'inactive.fixture@example.test', 'Inactive Fixture', 'Inactive Fixture', 'coach', 'Coach', 30, '10000000-0000-4000-8000-000000000001', 'suspended');

insert into public.team_staff (team_id, user_id)
values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003');

insert into public.players (id, club_id, team_id, player_name, section, team, status)
values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Available Fixture Player', 'Squad', 'Fixture Team One', 'active'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Other Team Fixture Player', 'Squad', 'Fixture Team Two', 'active'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'Other Club Fixture Player', 'Squad', 'Fixture Team Three', 'active'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Unavailable Fixture Player', 'Squad', 'Fixture Team One', 'active'),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Awaiting Fixture Player', 'Squad', 'Fixture Team One', 'active');

insert into public.match_days (id, club_id, team_id, opponent, match_date, status)
values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Fixture Opponent One', current_date + 2, 'scheduled'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'Fixture Opponent Two', current_date + 2, 'scheduled'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Fixture Opponent Three', current_date - 2, 'full_time');

insert into public.match_day_player_availability (
  match_day_id,
  club_id,
  team_id,
  player_id,
  player_name,
  status
)
values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Available Fixture Player', 'available'),
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', 'Unavailable Fixture Player', 'unavailable'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Available Fixture Player', 'available');

set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-4000-8000-000000000001';

do $$
declare
  saved_status text;
begin
  select decision.status into saved_status
  from public.set_match_day_player_squad_decision(
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'selected'
  ) decision;

  if saved_status <> 'selected' then
    raise exception 'Authorised staff selection did not persist.';
  end if;

  perform public.set_match_day_player_squad_decision(
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'waiting'
  );
  perform public.set_match_day_player_squad_decision(
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'not_selected'
  );
  perform public.set_match_day_player_squad_decision(
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'undecided'
  );
end;
$$;

do $$
begin
  begin
    perform public.set_match_day_player_squad_decision(
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      'selected'
    );
    raise exception 'Expected cross-team denial.';
  exception
    when others then
      if sqlerrm not like '%active squad player for the fixture team%' then
        raise;
      end if;
  end;

  begin
    perform public.set_match_day_player_squad_decision(
      '50000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000003',
      'selected'
    );
    raise exception 'Expected cross-club denial.';
  exception
    when others then
      if sqlerrm not like '%outside your club%' then
        raise;
      end if;
  end;

  begin
    perform public.set_match_day_player_squad_decision(
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000004',
      'selected'
    );
    raise exception 'Expected unavailable-player denial.';
  exception
    when others then
      if sqlerrm not like '%Available response%' then
        raise;
      end if;
  end;

  begin
    perform public.set_match_day_player_squad_decision(
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000005',
      'selected'
    );
    raise exception 'Expected awaiting-response denial.';
  exception
    when others then
      if sqlerrm not like '%Available response%' then
        raise;
      end if;
  end;

  begin
    perform public.set_match_day_player_squad_decision(
      '50000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000001',
      'waiting'
    );
    raise exception 'Expected locked-fixture denial.';
  exception
    when others then
      if sqlerrm not like '%locked for this fixture lifecycle%' then
        raise;
      end if;
  end;

  begin
    insert into public.match_day_player_squad_decisions (
      match_day_id,
      club_id,
      team_id,
      player_id,
      status
    )
    values (
      '50000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000005',
      'waiting'
    );
    raise exception 'Expected direct-write denial.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claim.sub = '30000000-0000-4000-8000-000000000003';

do $$
begin
  begin
    perform public.set_match_day_player_squad_decision(
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'selected'
    );
    raise exception 'Expected inactive-staff denial.';
  exception
    when others then
      if sqlerrm not like '%Only active authorised team staff%' then
        raise;
      end if;
  end;
end;
$$;

set local request.jwt.claim.sub = '30000000-0000-4000-8000-000000000002';

do $$
begin
  begin
    perform public.set_match_day_player_squad_decision(
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'selected'
    );
    raise exception 'Expected parent RPC denial.';
  exception
    when others then
      if sqlerrm not like '%Only active authorised team staff%' then
        raise;
      end if;
  end;
end;
$$;

do $$
declare
  visible_count integer;
begin
  select count(*) into visible_count
  from public.match_day_player_squad_decisions;

  if visible_count <> 0 then
    raise exception 'Parent direct table read exposed squad decisions.';
  end if;
end;
$$;

rollback;
