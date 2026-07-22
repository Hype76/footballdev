import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const hardeningMigrationUrl = new URL('../supabase/migrations/20260722084618_fp_v1_gameday_prematch_parity_harden_03.sql', import.meta.url)
const extendedMigrationUrl = new URL('../supabase/migrations/20260722195910_fp_v1_gameday_extended_ops_12a.sql', import.meta.url)
const hardeningDbTestUrl = new URL('./matchday-parent-scorer-hardening-db.test.mjs', import.meta.url)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  staff: '30000000-0000-4000-8000-000000000001',
  scorer: '30000000-0000-4000-8000-000000000002',
  ordinaryParent: '30000000-0000-4000-8000-000000000003',
  player: '40000000-0000-4000-8000-000000000001',
  scorerLink: '50000000-0000-4000-8000-000000000001',
  match: '60000000-0000-4000-8000-000000000001',
  deletedMatch: '60000000-0000-4000-8000-000000000002',
}

async function setActor(db, actorId) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
  await db.query("select set_config('request.jwt.claim.name', 'FP TEST Actor', false)")
  await db.query("select set_config('request.jwt.claim.email', 'fp-test@example.test', false)")
}

async function expectDatabaseError(promise, pattern) {
  await assert.rejects(promise, pattern)
}

test('disposable database validates extended lifecycle, authority, score separation, and shootout correction', async () => {
  const [hardeningMigration, migration, hardeningTestSource] = await Promise.all([
    readFile(hardeningMigrationUrl, 'utf8'),
    readFile(extendedMigrationUrl, 'utf8'),
    readFile(hardeningDbTestUrl, 'utf8'),
  ])
  const schemaMatch = hardeningTestSource.match(/const schemaSql = `([\s\S]*?)`;\r?\n\r?\nasync function setActor/)
  assert.ok(schemaMatch, 'Expected reusable Match Day disposable schema')

  const db = new PGlite()
  try {
    await db.exec(schemaMatch[1])
    await db.exec(`
      create table auth.users (id uuid primary key);
      create function public.can_read_match_day(target_team_id uuid)
      returns boolean language sql stable as $$ select true; $$;
      create function public.get_parent_portal_match_days(parent_link_id_value uuid)
      returns table (id uuid) language sql stable as $$ select null::uuid where false; $$;
    `)
    await db.exec(hardeningMigration)
    await db.query('insert into public.clubs(id) values ($1)', [ids.club])
    await db.query('insert into public.teams(id, club_id) values ($1, $2)', [ids.team, ids.club])
    await db.query(
      "insert into public.match_days(id, club_id, team_id, status, deleted_at) values ($1, $2, $3, 'full_time', now())",
      [ids.deletedMatch, ids.club, ids.team],
    )
    await db.exec(`
      create function public.prevent_deleted_match_day_update()
      returns trigger language plpgsql as $$
      begin
        if old.deleted_at is not null then
          raise exception 'A deleted previous game cannot be changed.';
        end if;
        return new;
      end;
      $$;
      create trigger prevent_deleted_match_day_update
      before update on public.match_days
      for each row execute function public.prevent_deleted_match_day_update();
    `)

    await db.exec('begin')
    await db.exec(migration)
    const insideTransaction = await db.query(
      "select to_regprocedure('public.record_match_day_shootout_kick(uuid,text,text,text,text)') is not null as present",
    )
    assert.equal(insideTransaction.rows[0].present, true)
    await db.exec('rollback')
    const afterRollback = await db.query(
      "select to_regprocedure('public.record_match_day_shootout_kick(uuid,text,text,text,text)') is not null as present",
    )
    assert.equal(afterRollback.rows[0].present, false)
    await db.exec(migration)
    const deletedState = await db.query(
      'select current_match_phase from public.match_days where id = $1',
      [ids.deletedMatch],
    )
    assert.equal(deletedState.rows[0].current_match_phase, 'pre_match')

    await db.query(
      `insert into public.users(id, club_id, role, status) values
        ($1, $2, 'coach', 'active'),
        ($3, $2, 'parent_portal', 'active'),
        ($4, $2, 'parent_portal', 'active')`,
      [ids.staff, ids.club, ids.scorer, ids.ordinaryParent],
    )
    await db.query('insert into auth.users(id) values ($1), ($2), ($3)', [ids.staff, ids.scorer, ids.ordinaryParent])
    await db.query(
      "insert into public.players(id, club_id, team_id, status) values ($1, $2, $3, 'active')",
      [ids.player, ids.club, ids.team],
    )
    await db.query(
      `insert into public.parent_player_links(id, club_id, team_id, player_id, auth_user_id, email, status)
       values ($1, $2, $3, $4, $5, 'fp-test@example.test', 'active')`,
      [ids.scorerLink, ids.club, ids.team, ids.player, ids.scorer],
    )
    await db.query(
      `insert into public.match_day_role_assignments(match_day_id, club_id, team_id, role, parent_link_id, auth_user_id)
       values ($1, $2, $3, 'scorer', $4, $5)`,
      [ids.match, ids.club, ids.team, ids.scorerLink, ids.scorer],
    )
    await db.query(
      `insert into public.match_day_scorer_assignments(match_day_id, club_id, team_id, parent_link_id, auth_user_id)
       values ($1, $2, $3, $4, $5)`,
      [ids.match, ids.club, ids.team, ids.scorerLink, ids.scorer],
    )
    await db.query(
      `insert into public.match_days(
        id, club_id, team_id, status, timer_status, timer_elapsed_seconds,
        match_conclusion_rule, current_match_phase, extra_time_period_count, home_score, away_score
      ) values ($1, $2, $3, 'second_half', 'running', 5400, 'extra_time', 'second_half', 1, 1, 1)`,
      [ids.match, ids.club, ids.team],
    )

    await setActor(db, ids.staff)
    await db.query("select public.set_match_day_extended_state($1, 'normal_time_complete')", [ids.match])
    await expectDatabaseError(
      db.query("select public.set_match_day_extended_state($1, 'normal_time_complete')", [ids.match]),
      /Normal time can only finish from active regulation play/,
    )
    await db.query("select public.set_match_day_extended_state($1, 'start_extra_time')", [ids.match])
    await expectDatabaseError(
      db.query("select public.set_match_day_extended_state($1, 'extra_time_half_time')", [ids.match]),
      /Extra time half time is not available/,
    )
    await db.query("select public.set_match_day_extended_state($1, 'complete_extra_time')", [ids.match])
    const onePeriodState = await db.query(
      'select current_match_phase, normal_time_home_score, extra_time_home_score from public.match_days where id = $1',
      [ids.match],
    )
    assert.deepEqual(onePeriodState.rows[0], {
      current_match_phase: 'extra_time_complete',
      normal_time_home_score: 1,
      extra_time_home_score: 1,
    })

    await db.query(
      `update public.match_days set
        status = 'second_half', timer_status = 'running', current_match_phase = 'second_half',
        match_conclusion_rule = 'straight_to_penalties', normal_time_home_score = null,
        normal_time_away_score = null, home_score = 1, away_score = 1
       where id = $1`,
      [ids.match],
    )
    await db.query("select public.set_match_day_extended_state($1, 'normal_time_complete')", [ids.match])
    await db.query("select public.set_match_day_extended_state($1, 'start_penalties')", [ids.match])

    await setActor(db, ids.ordinaryParent)
    await expectDatabaseError(
      db.query("select public.record_match_day_shootout_kick($1, 'club', 'scored', '', '')", [ids.match]),
      /selected scorer access is required/,
    )

    await setActor(db, ids.scorer)
    await db.query("select public.record_match_day_shootout_kick($1, 'club', 'scored', 'FP TEST Player', '')", [ids.match])
    await setActor(db, ids.staff)
    for (const [side, outcome] of [
      ['opponent', 'missed'], ['club', 'scored'], ['opponent', 'missed'],
      ['club', 'scored'], ['opponent', 'missed'],
    ]) {
      await db.query('select public.record_match_day_shootout_kick($1, $2, $3, $4, $5)', [ids.match, side, outcome, '', ''])
    }

    const decisiveState = await db.query(
      `select home_score, away_score, home_shootout_score, away_shootout_score,
        public.match_day_shootout_can_finish(id) as can_finish
       from public.match_days where id = $1`,
      [ids.match],
    )
    assert.deepEqual(decisiveState.rows[0], {
      home_score: 1,
      away_score: 1,
      home_shootout_score: 3,
      away_shootout_score: 0,
      can_finish: true,
    })
    await expectDatabaseError(
      db.query('update public.match_days set home_score = 2 where id = $1', [ids.match]),
      /Regulation score cannot change during a penalty shootout/,
    )

    const latestKick = await db.query(
      "select id from public.match_day_shootout_kicks where match_day_id = $1 and event_status = 'active' order by created_at desc, id desc limit 1",
      [ids.match],
    )
    await setActor(db, ids.scorer)
    await db.query("select public.void_match_day_shootout_kick($1, $2, 'FP TEST correction')", [ids.match, latestKick.rows[0].id])
    const correctedState = await db.query(
      'select away_shootout_score, public.match_day_shootout_can_finish(id) as can_finish from public.match_days where id = $1',
      [ids.match],
    )
    assert.deepEqual(correctedState.rows[0], { away_shootout_score: 0, can_finish: false })

    await db.query("select public.record_match_day_shootout_kick($1, 'opponent', 'missed', '', '')", [ids.match])
    await db.query("select public.set_match_day_timer_state($1, 'full_time')", [ids.match])
    const finalState = await db.query(
      'select status, current_match_phase, shootout_winner, home_score, away_score from public.match_days where id = $1',
      [ids.match],
    )
    assert.deepEqual(finalState.rows[0], {
      status: 'full_time',
      current_match_phase: 'full_time',
      shootout_winner: 'home',
      home_score: 1,
      away_score: 1,
    })
  } finally {
    await db.close()
  }
})
