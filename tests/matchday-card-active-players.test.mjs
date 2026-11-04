import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('cards can select an active team player without changing goal eligibility', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema private;
      create table private.test_players (id uuid, player_name text, shirt_number text, team_id uuid, selected boolean);
      create function private.match_day_substitution_participants(uuid)
      returns table(id uuid, player_name text, shirt_number text, team_id uuid)
      language sql as $$ select p.id,p.player_name,p.shirt_number,p.team_id from private.test_players p $$;
      create function private.match_day_event_participants(uuid)
      returns table(id uuid, player_name text, shirt_number text, team_id uuid)
      language sql as $$ select p.id,p.player_name,p.shirt_number,p.team_id from private.test_players p where p.selected $$;
      insert into private.test_players values
        ('10000000-0000-4000-8000-000000000001','Selected','7','20000000-0000-4000-8000-000000000001',true),
        ('10000000-0000-4000-8000-000000000002','Team player','8','20000000-0000-4000-8000-000000000001',false);
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20261104082334_matchday_card_active_team_players.sql', import.meta.url), 'utf8'))
    const matchId = '30000000-0000-4000-8000-000000000001'
    for (const eventType of ['yellow_card', 'red_card', 'substitution']) {
      const result = await db.query('select count(*)::integer as total from private.match_day_event_type_participants($1,$2)', [matchId, eventType])
      assert.equal(result.rows[0].total, 2, eventType)
    }
    const goal = await db.query('select count(*)::integer as total from private.match_day_event_type_participants($1,$2)', [matchId, 'goal'])
    assert.equal(goal.rows[0].total, 1)
  } finally {
    await db.close()
  }
})
