import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
const migration = readFileSync(new URL('../supabase/migrations/20260907094825_v1_atomic_team_labels.sql', import.meta.url), 'utf8')
test('a team label failure rolls back the team and every related record without touching another team or club', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table teams(id int primary key, club_id int, name text);
      create table players(id int primary key, club_id int, team_id int, team text);
      create table evaluations(id int primary key, club_id int, team_id int, team text);
      insert into teams values (1,1,'Old'),(2,1,'Other'),(3,2,'Old');
      insert into players values (1,1,1,'Old'),(2,1,null,'Old'),(3,1,2,'Old'),(4,2,3,'Old');
      insert into evaluations select * from players;`)
    await db.exec(migration)
    await db.exec(`alter table evaluations add constraint injected_failure check (team <> 'Failure');`)
    await assert.rejects(db.exec("update teams set name='Failure' where id=1"), {code:'23514'})
    assert.equal((await db.query('select name from teams where id=1')).rows[0].name,'Old')
    assert.ok((await db.query('select team from players')).rows.every((row)=>row.team==='Old'))
    await db.exec("update teams set name='New' where id=1")
    for (const table of ['players','evaluations']) assert.deepEqual((await db.query(`select team from ${table} order by id`)).rows.map((row)=>row.team),['New','New','Old','Old'])
    await db.exec('alter table teams enable row level security; grant select, update on teams to authenticated;')
    await db.exec('set role authenticated')
    assert.equal((await db.query("update teams set name='Unauthorised' where id=3 returning id")).rows.length,0)
    await assert.rejects(db.exec('select public.sync_renamed_team_labels_internal()'),{code:'42501'})
    await db.exec('reset role')
    assert.equal((await db.query('select name from teams where id=3')).rows[0].name,'Old')
  } finally { await db.close() }
})
