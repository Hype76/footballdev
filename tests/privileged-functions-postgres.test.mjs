import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'

const databaseUrl = String(process.env.PRIVILEGED_FUNCTIONS_TEST_DATABASE_URL ?? '').trim()
const shouldRun = Boolean(databaseUrl)

const ids = {
  clubA: '91000000-0000-4000-8000-000000000001',
  clubB: '91000000-0000-4000-8000-000000000002',
  clubC: '91000000-0000-4000-8000-000000000003',
  adminA: '91000000-0000-4000-8000-000000000101',
  managerA: '91000000-0000-4000-8000-000000000102',
  coachA: '91000000-0000-4000-8000-000000000103',
  parentA: '91000000-0000-4000-8000-000000000104',
  disabledA: '91000000-0000-4000-8000-000000000105',
  removedA: '91000000-0000-4000-8000-000000000106',
  ownerB: '91000000-0000-4000-8000-000000000107',
  ownerC: '91000000-0000-4000-8000-000000000108',
  teamA1: '91000000-0000-4000-8000-000000000201',
  teamA2: '91000000-0000-4000-8000-000000000202',
  teamB1: '91000000-0000-4000-8000-000000000203',
  playerA: '91000000-0000-4000-8000-000000000301',
  parentLinkA: '91000000-0000-4000-8000-000000000401',
  matchA: '91000000-0000-4000-8000-000000000501',
  staffPollRequest: '91000000-0000-4000-8000-000000000601',
  parentPollRequest: '91000000-0000-4000-8000-000000000602',
  rollbackPollRequest: '91000000-0000-4000-8000-000000000603',
}

function runPsql(sql, { rejectOnFailure = true, timeoutMs = 30000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('psql', [
      `--dbname=${databaseUrl}`,
      '-X',
      '-v', 'ON_ERROR_STOP=1',
      '-A',
      '-t',
    ], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      child.kill()
      if (!settled) {
        settled = true
        rejectPromise(new Error(`psql exceeded the ${timeoutMs}ms test process limit`))
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rejectPromise(error)
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const result = { exitCode, stderr, stdout }
      if (rejectOnFailure && exitCode !== 0) {
        rejectPromise(Object.assign(new Error(`psql exited with code ${exitCode}: ${stderr.trim()}`), { result }))
        return
      }
      resolvePromise(result)
    })
    child.stdin.end(sql)
  })
}

function authenticatedSql(actorId, sql, forgedClaims = {}) {
  const claims = JSON.stringify({
    sub: actorId,
    role: 'authenticated',
    ...forgedClaims,
  }).replaceAll("'", "''")
  return `
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = '${actorId}';
    set local request.jwt.claims = '${claims}';
    ${sql}
    commit;
  `
}

function serviceSql(sql) {
  return `
    begin;
    set local role service_role;
    ${sql}
    commit;
  `
}

async function expectDatabaseDenial(sql, pattern) {
  const result = await runPsql(sql, { rejectOnFailure: false })
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, pattern)
}

test('real PostgreSQL authority, grant, atomicity, idempotency and concurrency gate', {
  skip: shouldRun ? false : 'Set PRIVILEGED_FUNCTIONS_TEST_DATABASE_URL to an isolated disposable PostgreSQL database.',
  timeout: 120000,
}, async () => {
  await runPsql(`
    begin;
    delete from public.audit_logs where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.poll_votes where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.match_days where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.polls where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.match_locations where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.parent_player_links where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.players where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.team_staff where user_id in (
      '${ids.adminA}', '${ids.managerA}', '${ids.coachA}', '${ids.parentA}',
      '${ids.disabledA}', '${ids.removedA}', '${ids.ownerB}', '${ids.ownerC}'
    );
    delete from public.club_roles where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.user_club_memberships where auth_user_id in (
      '${ids.adminA}', '${ids.managerA}', '${ids.coachA}', '${ids.parentA}',
      '${ids.disabledA}', '${ids.removedA}', '${ids.ownerB}', '${ids.ownerC}'
    );
    delete from public.teams where club_id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    delete from public.users where id in (
      '${ids.adminA}', '${ids.managerA}', '${ids.coachA}', '${ids.parentA}',
      '${ids.disabledA}', '${ids.removedA}', '${ids.ownerB}', '${ids.ownerC}'
    );
    delete from auth.users where id in (
      '${ids.adminA}', '${ids.managerA}', '${ids.coachA}', '${ids.parentA}',
      '${ids.disabledA}', '${ids.removedA}', '${ids.ownerB}', '${ids.ownerC}'
    );
    delete from public.clubs where id in ('${ids.clubA}', '${ids.clubB}', '${ids.clubC}');
    insert into public.clubs(id, name) values
      ('${ids.clubA}', 'Authority Test A'),
      ('${ids.clubB}', 'Authority Test B'),
      ('${ids.clubC}', 'Authority Test C');

    insert into auth.users(id, email) values
      ('${ids.adminA}', 'admin-a@example.test'),
      ('${ids.managerA}', 'manager-a@example.test'),
      ('${ids.coachA}', 'coach-a@example.test'),
      ('${ids.parentA}', 'parent-a@example.test'),
      ('${ids.disabledA}', 'disabled-a@example.test'),
      ('${ids.removedA}', 'removed-a@example.test'),
      ('${ids.ownerB}', 'owner-b@example.test'),
      ('${ids.ownerC}', 'owner-c@example.test');

    insert into public.users(id, email, name, role, role_label, role_rank, club_id, status) values
      ('${ids.adminA}', 'admin-a@example.test', 'Admin A', 'admin', 'Club Admin', 90, '${ids.clubA}', 'active'),
      ('${ids.managerA}', 'manager-a@example.test', 'Manager A', 'manager', 'Manager', 50, '${ids.clubA}', 'active'),
      ('${ids.coachA}', 'coach-a@example.test', 'Coach A', 'coach', 'Coach', 30, '${ids.clubA}', 'active'),
      ('${ids.parentA}', 'parent-a@example.test', 'Parent A', 'parent_portal', 'Parent', 0, '${ids.clubA}', 'active'),
      ('${ids.disabledA}', 'disabled-a@example.test', 'Disabled A', 'manager', 'Manager', 50, '${ids.clubA}', 'suspended'),
      ('${ids.removedA}', 'removed-a@example.test', 'Removed A', 'manager', 'Manager', 50, '${ids.clubA}', 'active'),
      ('${ids.ownerB}', 'owner-b@example.test', 'Owner B', 'admin', 'Club Admin', 90, '${ids.clubB}', 'active'),
      ('${ids.ownerC}', 'owner-c@example.test', 'Owner C', 'admin', 'Club Admin', 90, '${ids.clubC}', 'active');

    insert into public.user_club_memberships(auth_user_id, email, name, role, role_label, role_rank, club_id) values
      ('${ids.adminA}', 'admin-a@example.test', 'Admin A', 'admin', 'Club Admin', 90, '${ids.clubA}'),
      ('${ids.managerA}', 'manager-a@example.test', 'Manager A', 'manager', 'Manager', 50, '${ids.clubA}'),
      ('${ids.coachA}', 'coach-a@example.test', 'Coach A', 'coach', 'Coach', 30, '${ids.clubA}'),
      ('${ids.parentA}', 'parent-a@example.test', 'Parent A', 'parent_portal', 'Parent', 0, '${ids.clubA}'),
      ('${ids.disabledA}', 'disabled-a@example.test', 'Disabled A', 'manager', 'Manager', 50, '${ids.clubA}'),
      ('${ids.ownerB}', 'owner-b@example.test', 'Owner B', 'admin', 'Club Admin', 90, '${ids.clubB}'),
      ('${ids.ownerC}', 'owner-c@example.test', 'Owner C', 'admin', 'Club Admin', 90, '${ids.clubC}');

    insert into public.teams(id, club_id, name) values
      ('${ids.teamA1}', '${ids.clubA}', 'Team A1'),
      ('${ids.teamA2}', '${ids.clubA}', 'Team A2'),
      ('${ids.teamB1}', '${ids.clubB}', 'Team B1');

    insert into public.team_staff(team_id, user_id) values
      ('${ids.teamA1}', '${ids.managerA}'),
      ('${ids.teamA1}', '${ids.coachA}'),
      ('${ids.teamA1}', '${ids.disabledA}'),
      ('${ids.teamB1}', '${ids.ownerB}');

    insert into public.players(id, club_id, team_id, player_name, section, team)
    values ('${ids.playerA}', '${ids.clubA}', '${ids.teamA1}', 'Player A', 'Squad', 'Team A1');

    insert into public.parent_player_links(
      id, club_id, team_id, player_id, email, auth_user_id, status, accepted_at
    ) values (
      '${ids.parentLinkA}', '${ids.clubA}', '${ids.teamA1}', '${ids.playerA}',
      'parent-a@example.test', '${ids.parentA}', 'active', timezone('utc', now())
    );

    insert into public.match_days(id, club_id, team_id, opponent, enable_motm_poll, created_by, created_by_name)
    values ('${ids.matchA}', '${ids.clubA}', '${ids.teamA1}', 'Test United', true, '${ids.managerA}', 'Manager A');
    commit;
  `)

  const metadata = await runPsql(`
    with expected(signature) as (values
      ('public.seed_default_club_roles()'),
      ('public.seed_default_club_roles_for_actor(uuid,uuid,text)'),
      ('public.create_club_role(text,text,integer)'),
      ('public.upsert_match_location_for_team(uuid,text,text,text)'),
      ('public.create_team_poll(uuid,text,text,text,text,jsonb,timestamp with time zone,boolean,integer,boolean,boolean,boolean,boolean,uuid)'),
      ('public.set_team_poll_status(uuid,text)'),
      ('public.delete_team_poll(uuid)'),
      ('public.submit_staff_poll_vote(uuid,text)'),
      ('public.get_parent_portal_polls(uuid)'),
      ('public.submit_parent_portal_poll_vote(uuid,uuid,text)'),
      ('public.create_match_day_motm_poll(uuid)'),
      ('public.create_match_day_motm_poll_on_full_time()')
    )
    select jsonb_build_object(
      'definition_violations', count(*) filter (
        where pg_get_userbyid(proc.proowner) <> 'postgres'
          or proc.prosecdef is false
          or not coalesce(proc.proconfig @> array['search_path=""'], false)
      ),
      'anon_execute', count(*) filter (where has_function_privilege('anon', expected.signature, 'execute')),
      'public_execute', count(*) filter (
        where exists (
          select 1
          from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) function_acl
          where function_acl.grantee = 0 and function_acl.privilege_type = 'EXECUTE'
        )
      ),
      'old_location_exists', to_regprocedure('public.upsert_match_location(uuid,text,text,text)') is not null,
      'old_seed_exists', to_regprocedure('public.seed_default_club_roles(uuid)') is not null,
      'authenticated_direct_writes',
        has_table_privilege('authenticated', 'public.match_locations', 'insert,update,delete')
        or has_table_privilege('authenticated', 'public.polls', 'insert,update,delete')
        or has_table_privilege('authenticated', 'public.poll_votes', 'insert,update,delete')
        or has_table_privilege('authenticated', 'public.club_roles', 'insert,update,delete'),
      'private_schema_exposed',
        has_schema_privilege('authenticated', 'app_private', 'usage')
        or has_schema_privilege('anon', 'app_private', 'usage')
        or has_schema_privilege('service_role', 'app_private', 'usage'),
      'service_wrapper_granted', has_function_privilege(
        'service_role', 'public.seed_default_club_roles_for_actor(uuid,uuid,text)', 'execute'
      ),
      'service_user_wrapper_granted', has_function_privilege(
        'service_role', 'public.upsert_match_location_for_team(uuid,text,text,text)', 'execute'
      ),
      'internal_trigger_granted', has_function_privilege(
        'authenticated', 'public.create_match_day_motm_poll(uuid)', 'execute'
      )
    )
    from expected
    join pg_proc proc on proc.oid = expected.signature::regprocedure;
  `)
  assert.match(metadata.stdout, /"definition_violations": 0/)
  assert.match(metadata.stdout, /"anon_execute": 0/)
  assert.match(metadata.stdout, /"public_execute": 0/)
  assert.match(metadata.stdout, /"old_location_exists": false/)
  assert.match(metadata.stdout, /"old_seed_exists": false/)
  assert.match(metadata.stdout, /"authenticated_direct_writes": false/)
  assert.match(metadata.stdout, /"private_schema_exposed": false/)
  assert.match(metadata.stdout, /"service_wrapper_granted": true/)
  assert.match(metadata.stdout, /"service_user_wrapper_granted": false/)
  assert.match(metadata.stdout, /"internal_trigger_granted": false/)

  const firstLocation = await runPsql(authenticatedSql(ids.managerA, `
    select public.upsert_match_location_for_team('${ids.teamA1}', 'Test Ground', '1 Test Street', 'North gate');
  `, { role: 'super_admin', club_id: ids.clubB, role_rank: 999 }))
  const locationId = firstLocation.stdout.match(/[0-9a-f-]{36}/i)?.[0]
  assert.ok(locationId)

  const duplicateLocations = await Promise.all([
    runPsql(authenticatedSql(ids.managerA, `
      select public.upsert_match_location_for_team('${ids.teamA1}', 'Test Ground', '1 Test Street', 'North gate');
    `)),
    runPsql(authenticatedSql(ids.managerA, `
      select public.upsert_match_location_for_team('${ids.teamA1}', 'Test Ground', '1 Test Street', 'North gate');
    `)),
  ])
  assert.equal(duplicateLocations[0].stdout.match(/[0-9a-f-]{36}/i)?.[0], locationId)
  assert.equal(duplicateLocations[1].stdout.match(/[0-9a-f-]{36}/i)?.[0], locationId)
  const locationState = await runPsql(`
    select jsonb_build_object(
      'count', count(*),
      'audit_count', count(*) filter (where false)
    ) from public.match_locations
    where club_id = '${ids.clubA}' and lower(name) = 'test ground';
    select count(*) from public.audit_logs
    where club_id = '${ids.clubA}' and action = 'match_location_created' and entity_id = '${locationId}';
  `)
  assert.match(locationState.stdout, /"count": 1/)
  assert.match(locationState.stdout, /\n1\s*$/)

  await runPsql(authenticatedSql(ids.coachA, `
    select public.upsert_match_location_for_team('${ids.teamA1}', 'Coach Ground', '', '');
  `))
  await runPsql(authenticatedSql(ids.adminA, `
    select public.upsert_match_location_for_team('${ids.teamA2}', 'Admin Ground', '', '');
  `))

  await expectDatabaseDenial(authenticatedSql(ids.managerA, `
    select public.upsert_match_location_for_team('${ids.teamA2}', 'Wrong Team', '', '');
  `), /match_location_not_permitted/)
  await expectDatabaseDenial(authenticatedSql(ids.managerA, `
    select public.upsert_match_location_for_team('${ids.teamB1}', 'Wrong Club', '', '');
  `), /match_location_not_permitted/)
  await expectDatabaseDenial(authenticatedSql(ids.parentA, `
    select public.upsert_match_location_for_team('${ids.teamA1}', 'Parent Ground', '', '');
  `), /match_location_not_permitted/)
  await expectDatabaseDenial(authenticatedSql(ids.disabledA, `
    select public.upsert_match_location_for_team('${ids.teamA1}', 'Disabled Ground', '', '');
  `), /match_location_not_permitted/)
  await expectDatabaseDenial(authenticatedSql(ids.removedA, `
    select public.upsert_match_location_for_team('${ids.teamA1}', 'Removed Ground', '', '');
  `), /match_location_not_permitted/)
  await expectDatabaseDenial(authenticatedSql(ids.managerA, `
    select app_private.actor_can_manage_team_resource('${ids.managerA}', '${ids.clubA}', '${ids.teamA1}', 20);
  `), /permission denied/)

  const seededA = await runPsql(authenticatedSql(ids.adminA, `select public.seed_default_club_roles();`))
  assert.match(seededA.stdout, /\b5\b/)
  const reseededA = await runPsql(authenticatedSql(ids.adminA, `select public.seed_default_club_roles();`))
  assert.match(reseededA.stdout, /\b0\b/)
  await runPsql(authenticatedSql(ids.adminA, `
    select (public.create_club_role('analyst', 'Analyst', 60)).role_key;
  `))
  await expectDatabaseDenial(authenticatedSql(ids.adminA, `
    select public.create_club_role('super_admin', 'Superadmin', 70);
  `), /role_definition_invalid/)
  await expectDatabaseDenial(authenticatedSql(ids.adminA, `
    select public.create_club_role('director', 'Director', 90);
  `), /role_definition_invalid/)
  await expectDatabaseDenial(authenticatedSql(ids.managerA, `select public.seed_default_club_roles();`), /role_seed_not_permitted/)
  await expectDatabaseDenial(authenticatedSql(ids.parentA, `select public.seed_default_club_roles();`), /role_seed_not_permitted/)

  await runPsql(`
    create or replace function public.fail_authority_role_seed()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if new.club_id = '${ids.clubC}' and new.role_key = 'manager' then
        raise exception 'CONTROLLED_ROLE_SEED_FAILURE';
      end if;
      return new;
    end;
    $$;
    create trigger fail_authority_role_seed
      before insert on public.club_roles
      for each row execute function public.fail_authority_role_seed();
  `)
  await expectDatabaseDenial(serviceSql(`
    select public.seed_default_club_roles_for_actor('${ids.clubC}', '${ids.ownerC}', 'signup_workspace');
  `), /CONTROLLED_ROLE_SEED_FAILURE/)
  const partialSeed = await runPsql(`select count(*) from public.club_roles where club_id = '${ids.clubC}';`)
  assert.match(partialSeed.stdout, /^0\s*$/)
  await runPsql(`
    drop trigger fail_authority_role_seed on public.club_roles;
    drop function public.fail_authority_role_seed();
  `)

  const concurrentSeeds = await Promise.all([
    runPsql(serviceSql(`
      select public.seed_default_club_roles_for_actor('${ids.clubB}', '${ids.ownerB}', 'signup_workspace');
    `)),
    runPsql(serviceSql(`
      select public.seed_default_club_roles_for_actor('${ids.clubB}', '${ids.ownerB}', 'signup_workspace');
    `)),
  ])
  assert.deepEqual(concurrentSeeds.map((result) => Number(result.stdout.match(/\b[05]\b/)?.[0])).sort(), [0, 5])
  const seedState = await runPsql(`
    select jsonb_build_object(
      'role_count', count(*),
      'distinct_role_count', count(distinct role_key),
      'custom_a_preserved', (select count(*) from public.club_roles where club_id = '${ids.clubA}' and role_key = 'analyst' and role_rank = 60),
      'seed_audits', (select count(*) from public.audit_logs where club_id in ('${ids.clubA}', '${ids.clubB}') and action = 'default_club_roles_seeded')
    ) from public.club_roles where club_id = '${ids.clubB}';
  `)
  assert.match(seedState.stdout, /"role_count": 5/)
  assert.match(seedState.stdout, /"distinct_role_count": 5/)
  assert.match(seedState.stdout, /"custom_a_preserved": 1/)
  assert.match(seedState.stdout, /"seed_audits": 2/)
  await expectDatabaseDenial(serviceSql(`
    select public.seed_default_club_roles_for_actor('${ids.clubA}', '${ids.ownerB}', 'signup_workspace');
  `), /role_seed_not_permitted/)

  const createStaffPollSql = `
    select (public.create_team_poll(
      '${ids.teamA1}', 'Availability', 'Choose one', 'staff', 'text',
      '[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]'::jsonb,
      null, false, null, true, true, false, false, '${ids.staffPollRequest}'
    )).id;
  `
  const staffPoll = await runPsql(authenticatedSql(ids.managerA, createStaffPollSql))
  const staffPollId = staffPoll.stdout.match(/[0-9a-f-]{36}/i)?.[0]
  assert.ok(staffPollId)
  const retriedStaffPoll = await runPsql(authenticatedSql(ids.managerA, createStaffPollSql))
  assert.equal(retriedStaffPoll.stdout.match(/[0-9a-f-]{36}/i)?.[0], staffPollId)
  await expectDatabaseDenial(authenticatedSql(ids.managerA, `
    select public.create_team_poll(
      '${ids.teamA1}', 'Conflicting retry', '', 'staff', 'text',
      '[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]'::jsonb,
      null, false, null, true, true, false, false, '${ids.staffPollRequest}'
    );
  `), /poll_request_conflict/)
  await expectDatabaseDenial(authenticatedSql(ids.parentA, createStaffPollSql), /poll_change_not_permitted/)
  await expectDatabaseDenial(authenticatedSql(ids.managerA, createStaffPollSql.replace(ids.teamA1, ids.teamA2)), /poll_change_not_permitted/)

  const createParentPollSql = `
    select (public.create_team_poll(
      '${ids.teamA1}', 'Player of the Match', '', 'parents', 'awards',
      '[{"id":"player-a","label":"Player A","playerId":"${ids.playerA}"},{"id":"other","label":"Other"}]'::jsonb,
      null, false, null, true, true, true, false, '${ids.parentPollRequest}'
    )).id;
  `
  const parentPoll = await runPsql(authenticatedSql(ids.managerA, createParentPollSql))
  const parentPollId = parentPoll.stdout.match(/[0-9a-f-]{36}/i)?.[0]
  assert.ok(parentPollId)
  const parentList = await runPsql(authenticatedSql(ids.parentA, `
    select count(*) from public.get_parent_portal_polls('${ids.parentLinkA}') where id = '${parentPollId}';
  `))
  assert.match(parentList.stdout, /\r?\n1\r?\n/)
  await runPsql(authenticatedSql(ids.parentA, `
    select public.submit_parent_portal_poll_vote('${ids.parentLinkA}', '${parentPollId}', 'other');
  `))
  const parentRetry = await runPsql(authenticatedSql(ids.parentA, `
    select public.submit_parent_portal_poll_vote('${ids.parentLinkA}', '${parentPollId}', 'other');
  `))
  assert.match(parentRetry.stdout, /[0-9a-f-]{36}/i)
  await expectDatabaseDenial(authenticatedSql(ids.parentA, `
    select public.set_team_poll_status('${parentPollId}', 'closed');
  `), /poll_change_not_permitted/)

  const concurrentVotes = await Promise.all([
    runPsql(authenticatedSql(ids.managerA, `select public.submit_staff_poll_vote('${staffPollId}', 'yes');`)),
    runPsql(authenticatedSql(ids.managerA, `select public.submit_staff_poll_vote('${staffPollId}', 'yes');`)),
  ])
  const voteIds = concurrentVotes.map((result) => result.stdout.match(/[0-9a-f-]{36}/i)?.[0])
  assert.ok(voteIds[0])
  assert.equal(voteIds[0], voteIds[1])
  const voteState = await runPsql(`
    select jsonb_build_object(
      'staff_votes', count(*) filter (where poll_id = '${staffPollId}' and auth_user_id = '${ids.managerA}'),
      'parent_votes', count(*) filter (where poll_id = '${parentPollId}' and auth_user_id = '${ids.parentA}'),
      'staff_audits', (select count(*) from public.audit_logs where action = 'poll_vote_submitted' and entity_id = '${staffPollId}'),
      'parent_audits', (select count(*) from public.audit_logs where action = 'parent_poll_vote_submitted' and entity_id = '${parentPollId}')
    ) from public.poll_votes;
  `)
  assert.match(voteState.stdout, /"staff_votes": 1/)
  assert.match(voteState.stdout, /"parent_votes": 1/)
  assert.match(voteState.stdout, /"staff_audits": 1/)
  assert.match(voteState.stdout, /"parent_audits": 1/)
  await expectDatabaseDenial(authenticatedSql(ids.coachA, `
    select public.submit_staff_poll_vote('${staffPollId}', 'invalid');
  `), /poll_vote_invalid/)
  await expectDatabaseDenial(authenticatedSql(ids.removedA, `
    select public.submit_staff_poll_vote('${staffPollId}', 'yes');
  `), /poll_vote_not_permitted/)
  await expectDatabaseDenial(authenticatedSql(ids.managerA, `
    select public.delete_team_poll('${staffPollId}');
  `), /poll_delete_unsafe/)

  await runPsql(authenticatedSql(ids.managerA, `
    select public.set_team_poll_status('${staffPollId}', 'open');
  `))
  const closeTransaction = runPsql(authenticatedSql(ids.managerA, `
    select public.set_team_poll_status('${staffPollId}', 'closed');
    select pg_sleep(1);
  `), { timeoutMs: 10000 })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
  const voteWhileClosing = runPsql(authenticatedSql(ids.coachA, `
    select public.submit_staff_poll_vote('${staffPollId}', 'no');
  `), { rejectOnFailure: false, timeoutMs: 10000 })
  const [closed, deniedVote] = await Promise.all([closeTransaction, voteWhileClosing])
  assert.equal(closed.exitCode, 0)
  assert.notEqual(deniedVote.exitCode, 0)
  assert.match(deniedVote.stderr, /poll_vote_not_permitted/)
  assert.doesNotMatch(deniedVote.stderr, /deadlock detected/i)

  await runPsql(authenticatedSql(ids.managerA, `
    update public.match_days
    set status = 'full_time'
    where id = '${ids.matchA}';
    select motm_poll_id from public.match_days where id = '${ids.matchA}';
  `))
  const matchPollState = await runPsql(`
    select jsonb_build_object(
      'poll_count', count(*),
      'linked', count(*) filter (where id = (select motm_poll_id from public.match_days where id = '${ids.matchA}')),
      'audit_count', (select count(*) from public.audit_logs where action = 'match_day_poll_created' and metadata ->> 'matchDayId' = '${ids.matchA}')
    ) from public.polls where title = 'Player of the Match' and club_id = '${ids.clubA}';
  `)
  assert.match(matchPollState.stdout, /"linked": 1/)
  assert.match(matchPollState.stdout, /"audit_count": 1/)
  await runPsql(authenticatedSql(ids.managerA, `
    update public.match_days set status = 'full_time' where id = '${ids.matchA}';
  `))
  const matchPollRetry = await runPsql(`
    select count(*) from public.audit_logs
    where action = 'match_day_poll_created' and metadata ->> 'matchDayId' = '${ids.matchA}';
  `)
  assert.match(matchPollRetry.stdout, /^1\s*$/)

  const rolledBackCreate = await runPsql(authenticatedSql(ids.managerA, `
    select public.create_team_poll(
      '${ids.teamA1}', 'Rollback Poll', '', 'staff', 'text',
      '[{"id":"one","label":"One"},{"id":"two","label":"Two"}]'::jsonb,
      null, false, null, true, true, false, false, '${ids.rollbackPollRequest}'
    );
    select 1 / 0;
  `), { rejectOnFailure: false })
  assert.notEqual(rolledBackCreate.exitCode, 0)
  assert.match(rolledBackCreate.stderr, /division by zero/)
  const rollbackState = await runPsql(`
    select jsonb_build_object(
      'polls', count(*),
      'audits', (select count(*) from public.audit_logs where action = 'poll_created' and metadata ->> 'requestId' = '${ids.rollbackPollRequest}')
    ) from public.polls where privileged_request_id = '${ids.rollbackPollRequest}';
  `)
  assert.match(rollbackState.stdout, /"polls": 0/)
  assert.match(rollbackState.stdout, /"audits": 0/)
})
