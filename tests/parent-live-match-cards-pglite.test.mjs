import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('parent card read is scoped to an authorised match and excludes voided cards', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  const match = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const link = '33333333-3333-4333-8333-333333333333'
  await db.exec(`
    create role anon; create role authenticated;
    create table public.match_day_events(match_day_id uuid, event_type text, team_side text, event_status text);
    create table public.allowed_matches(link_id uuid, id uuid);
    create function public.get_parent_portal_match_days(parent_link_id_value uuid)
    returns table(id uuid) language sql stable as $$
      select allowed.id from public.allowed_matches allowed where allowed.link_id = parent_link_id_value;
    $$;
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261103213000_parent_live_match_cards.sql', import.meta.url), 'utf8'))
  await db.query('insert into public.allowed_matches values ($1, $2)', [link, match])
  for (const [id, status] of [[match, 'active'], [match, 'voided'], [other, 'active']]) {
    await db.query('insert into public.match_day_events values ($1, $2, $3, $4)', [id, 'yellow_card', 'opponent', status])
  }
  const allowed = await db.query('select * from public.get_parent_live_match_cards($1, $2)', [match, link])
  const denied = await db.query('select * from public.get_parent_live_match_cards($1, $2)', [other, link])
  assert.deepEqual(allowed.rows, [{ event_type: 'yellow_card', team_side: 'opponent', event_status: 'active' }])
  assert.deepEqual(denied.rows, [])
})
