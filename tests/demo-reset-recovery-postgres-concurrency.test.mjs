import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const databaseUrl = String(process.env.DEMO_RESET_TEST_DATABASE_URL ?? '').trim()
const shouldRun = Boolean(databaseUrl)
const testDirectory = dirname(fileURLToPath(import.meta.url))
const migrationPath = resolve(testDirectory, '../supabase/migrations/20260719092052_p0_demo_reset_atomic_recovery.sql')
const pgliteTestPath = resolve(testDirectory, 'demo-reset-recovery-pglite.test.mjs')

function runProcess(command, args, { input = '', rejectOnFailure = true, timeoutMs = 20000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finishWithError = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rejectPromise(error)
    }
    const timeout = setTimeout(() => {
      child.kill()
      finishWithError(new Error(`${command} exceeded the ${timeoutMs}ms test process limit`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', finishWithError)
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const result = { exitCode, stderr, stdout }
      if (rejectOnFailure && exitCode !== 0) {
        rejectPromise(Object.assign(new Error(`${command} exited with code ${exitCode}`), { result }))
        return
      }
      resolvePromise(result)
    })

    child.stdin.end(input)
  })
}

function psqlArguments() {
  const parsed = new URL(databaseUrl)
  const args = [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-h', parsed.hostname,
    '-p', parsed.port || '5432',
    '-U', decodeURIComponent(parsed.username || 'postgres'),
    '-d', decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  ]
  return args
}

test('two real PostgreSQL reset transactions serialize without deadlock or partial state', {
  skip: shouldRun ? false : 'Set DEMO_RESET_TEST_DATABASE_URL to an isolated disposable PostgreSQL database.',
  timeout: 30000,
}, async () => {
  const args = psqlArguments()
  const psql = (sql, options = {}) => runProcess('psql', args, { input: sql, ...options })
  const pgliteSource = await readFile(pgliteTestPath, 'utf8')
  const schemaMatch = pgliteSource.match(/const schemaSql = `([\s\S]+?)`\r?\n\r?\nasync function createDatabase/)
  assert.ok(schemaMatch, 'The reusable demo reset test schema must be present.')

  await psql(schemaMatch[1])
  await runProcess('psql', [...args, '-f', migrationPath])
  await psql(`
    create trigger parent_chat_team_staff_sync
    after insert or update of team_id, user_id or delete on public.team_staff
    for each row execute function public.parent_chat_sync_team_staff();
    create trigger parent_chat_parent_link_sync
    after insert or update of status, auth_user_id, team_id, player_id or delete on public.parent_player_links
    for each row execute function public.parent_chat_sync_parent_link();

    insert into public.clubs(id, name)
    values ('20000000-0000-4000-8000-000000000001', 'Cambourne Town Academy FC');
    insert into auth.users(id, email)
    values ('10000000-0000-4000-8000-000000000001', 'demo@playerfeedback.online');
    insert into public.users(id, email, club_id, role, role_rank)
    values ('10000000-0000-4000-8000-000000000001', 'demo@playerfeedback.online', '20000000-0000-4000-8000-000000000001', 'head_manager', 70);
    insert into public.user_club_memberships(auth_user_id, club_id, email, role, role_label, role_rank)
    values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'demo@playerfeedback.online', 'head_manager', 'Team Admin', 70);
    insert into public.teams(id, club_id, name, created_by) values
      ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'U12 Tigers', '10000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'U14 Falcons', '10000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'U16 Lions', '10000000-0000-4000-8000-000000000001');

    create function public.slow_demo_reset_insert()
    returns trigger language plpgsql as $function$
    begin
      if current_setting('test.demo_reset_slow', true) = 'on' then
        perform set_config('test.demo_reset_slow', 'off', false);
        perform pg_sleep(3);
      end if;
      return new;
    end;
    $function$;
    create trigger slow_demo_reset_insert before insert on public.form_fields
    for each row execute function public.slow_demo_reset_insert();
  `)

  const firstReset = psql(`
    select set_config('test.demo_reset_slow', 'on', false);
    select public.reset_demo_account_atomic(
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000020'
    );
  `)
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 350))
  const [secondReset, thirdReset] = await Promise.all([
    psql(`
      select public.reset_demo_account_atomic(
        '10000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000021'
      );
    `, { rejectOnFailure: false }),
    psql(`
      select public.reset_demo_account_atomic(
        '10000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000022'
      );
    `, { rejectOnFailure: false }),
  ])
  const completedReset = await firstReset

  assert.equal(completedReset.exitCode, 0)
  for (const competingReset of [secondReset, thirdReset]) {
    assert.notEqual(competingReset.exitCode, 0)
    assert.match(competingReset.stderr, /DEMO_RESET_LOCKED/)
    assert.doesNotMatch(competingReset.stderr, /deadlock detected/i)
  }

  const state = await psql(`
    select jsonb_build_object(
      'completed', (select count(*) from public.demo_reset_operations where outcome = 'completed'),
      'teams', (select count(*) from public.teams),
      'staff', (select count(*) from public.team_staff),
      'matches', (select count(*) from public.match_days)
    );
  `)
  assert.match(state.stdout, /"completed": 1/)
  assert.match(state.stdout, /"teams": 3/)
  assert.match(state.stdout, /"staff": 3/)
  assert.match(state.stdout, /"matches": 2/)

  const cachedRetry = await psql(`
    select public.reset_demo_account_atomic(
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000020'
    ) ->> 'cached';
  `)
  assert.match(cachedRetry.stdout, /true/)

  await psql(`
    select set_config('app.demo_reset_skip_communication_sync', 'on', false);
    delete from public.team_staff
    where team_id = '30000000-0000-4000-8000-000000000001'
      and user_id = '10000000-0000-4000-8000-000000000001';
    delete from public.polls where id = public.demo_reset_uuid('poll:availability');

    create function public.fail_demo_poll_insert()
    returns trigger language plpgsql as $function$
    begin
      if current_setting('test.demo_reset_fail', true) = 'on' then
        raise exception 'CONTROLLED_DEMO_RESET_FAILURE';
      end if;
      return new;
    end;
    $function$;
    create trigger fail_demo_poll_insert before insert on public.polls
    for each row execute function public.fail_demo_poll_insert();
  `)

  const partialFingerprint = await psql(`
    select public.demo_reset_state_fingerprint(
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001'
    );
  `)
  const partialFingerprintValue = partialFingerprint.stdout.match(/[0-9a-f]{32}/)?.[0]
  assert.ok(partialFingerprintValue)
  const failedReset = await psql(`
    select set_config('test.demo_reset_fail', 'on', false);
    select public.reset_demo_account_atomic(
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000030'
    );
  `, { rejectOnFailure: false })

  assert.notEqual(failedReset.exitCode, 0)
  assert.match(failedReset.stderr, /CONTROLLED_DEMO_RESET_FAILURE/)
  assert.doesNotMatch(failedReset.stderr, /deadlock detected/i)

  const rolledBackState = await psql(`
    select jsonb_build_object(
      'fingerprint', public.demo_reset_state_fingerprint(
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001'
      ),
      'failed_operations', (
        select count(*) from public.demo_reset_operations
        where operation_id = '50000000-0000-4000-8000-000000000030'
      )
    );
  `)
  assert.match(rolledBackState.stdout, new RegExp(partialFingerprintValue))
  assert.match(rolledBackState.stdout, /"failed_operations": 0/)

  await psql(`
    drop trigger fail_demo_poll_insert on public.polls;
    drop function public.fail_demo_poll_insert();
  `)
  const retryAfterFailure = await psql(`
    select public.reset_demo_account_atomic(
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000030'
    ) ->> 'success';
  `)
  assert.match(retryAfterFailure.stdout, /true/)
})
