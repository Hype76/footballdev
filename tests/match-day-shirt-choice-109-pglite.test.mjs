import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260826120000_match_day_shirt_choice.sql', import.meta.url)
const IDS = {
  link: '10000000-0000-4000-8000-000000000001',
  match: '20000000-0000-4000-8000-000000000001',
  request: '30000000-0000-4000-8000-000000000001',
}

const schemaSql = `
create role anon;
create role authenticated;
create role service_role;

create table public.match_days (
  id uuid primary key,
  deleted_at timestamptz
);

create table public.match_day_availability_requests (
  id uuid primary key,
  match_day_id uuid not null references public.match_days(id),
  token_hash text not null
);

create function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (id uuid)
language sql stable
as $$ select '${IDS.match}'::uuid where parent_link_id_value = '${IDS.link}'::uuid $$;

create function public.get_parent_portal_invitation_state(parent_link_id_value uuid)
returns table (source_event_type text, event_id uuid)
language sql stable
as $$ select 'match_day'::text, '${IDS.match}'::uuid where parent_link_id_value = '${IDS.link}'::uuid $$;

create function public.is_match_day_action_token_current_internal(token_hash_value text)
returns boolean
language sql stable
as $$ select token_hash_value = 'current-token' $$;
`

test('shirt migration defaults legacy fixtures and enforces authorised read helpers', async () => {
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.exec(await readFile(migrationUrl, 'utf8'))
    await db.query('insert into public.match_days(id) values ($1)', [IDS.match])
    await db.query(
      'insert into public.match_day_availability_requests(id, match_day_id, token_hash) values ($1, $2, $3)',
      [IDS.request, IDS.match, 'current-token'],
    )

    const legacy = await db.query('select shirt_choice from public.match_days where id = $1', [IDS.match])
    assert.equal(legacy.rows[0].shirt_choice, 'home')

    await db.query("update public.match_days set shirt_choice = 'away' where id = $1", [IDS.match])
    const parent = await db.query('select * from public.get_parent_portal_match_shirt_choices($1)', [IDS.link])
    assert.deepEqual(parent.rows, [{ match_day_id: IDS.match, shirt_choice: 'away' }])

    const token = await db.query("select public.get_match_day_availability_shirt_choice('current-token') as shirt_choice")
    assert.equal(token.rows[0].shirt_choice, 'away')
    const expired = await db.query("select public.get_match_day_availability_shirt_choice('expired-token') as shirt_choice")
    assert.equal(expired.rows[0].shirt_choice, null)

    await assert.rejects(
      db.query("update public.match_days set shirt_choice = 'third' where id = $1", [IDS.match]),
      /match_days_shirt_choice_check/,
    )
  } finally {
    await db.close()
  }
})
