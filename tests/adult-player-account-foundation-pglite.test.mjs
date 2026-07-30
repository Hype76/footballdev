import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260730110000_adult_player_account_foundation.sql', import.meta.url)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  otherClub: '10000000-0000-4000-8000-000000000002',
  team: '20000000-0000-4000-8000-000000000001',
  otherTeam: '20000000-0000-4000-8000-000000000002',
  adultUser: '30000000-0000-4000-8000-000000000001',
  secondAdultUser: '30000000-0000-4000-8000-000000000002',
  invalidUser: '30000000-0000-4000-8000-000000000099',
  adultPlayer: '40000000-0000-4000-8000-000000000001',
  secondAdultPlayer: '40000000-0000-4000-8000-000000000002',
  minorPlayer: '40000000-0000-4000-8000-000000000003',
  missingDobPlayer: '40000000-0000-4000-8000-000000000004',
  parentManagedPlayer: '40000000-0000-4000-8000-000000000005',
}

async function setClaims(db, userId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId }),
  ])
}

async function createDatabase() {
  const migration = await readFile(migrationUrl, 'utf8')
  const invitationFunctionStart = migration.indexOf(
    'create or replace function public.get_own_adult_player_invitation_state()',
  )
  assert.ok(invitationFunctionStart > 0)

  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

    create table auth.users (
      id uuid primary key
    );

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.clubs (
      id uuid primary key,
      name text not null,
      logo_url text,
      contact_email text,
      theme_accent text,
      theme_button_style text
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs (id),
      name text not null,
      theme_mode text,
      theme_accent text,
      theme_button_style text
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs (id),
      team_id uuid references public.teams (id),
      player_name text not null,
      team text not null default '',
      status text not null default 'active',
      archived_at timestamptz,
      date_of_birth date,
      contact_type text not null default 'parent'
    );
    alter table public.players enable row level security;

    create table public.users (
      id uuid primary key
    );

    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid,
      player_id uuid not null references public.players (id),
      status text not null default 'active'
    );

    grant select on public.players to authenticated;

    insert into public.clubs (id, name, contact_email)
    values
      ('${ids.club}', 'FP TEST Club', 'club@example.invalid'),
      ('${ids.otherClub}', 'Other Club', 'other@example.invalid');

    insert into public.teams (id, club_id, name)
    values
      ('${ids.team}', '${ids.club}', 'FP TEST Team'),
      ('${ids.otherTeam}', '${ids.otherClub}', 'Other Team');

    insert into auth.users (id)
    values
      ('${ids.adultUser}'),
      ('${ids.secondAdultUser}');

    insert into public.players (
      id, club_id, team_id, player_name, team, status, date_of_birth, contact_type
    )
    values
      ('${ids.adultPlayer}', '${ids.club}', '${ids.team}', 'Adult Player', 'FP TEST Team', 'active', current_date - interval '25 years', 'self'),
      ('${ids.secondAdultPlayer}', '${ids.club}', '${ids.team}', 'Second Adult', 'FP TEST Team', 'active', current_date - interval '21 years', 'both'),
      ('${ids.minorPlayer}', '${ids.club}', '${ids.team}', 'Minor Player', 'FP TEST Team', 'active', current_date - interval '17 years', 'self'),
      ('${ids.missingDobPlayer}', '${ids.club}', '${ids.team}', 'Missing DOB', 'FP TEST Team', 'active', null, 'self'),
      ('${ids.parentManagedPlayer}', '${ids.club}', '${ids.team}', 'Parent Managed', 'FP TEST Team', 'active', current_date - interval '30 years', 'parent');
  `)

  await db.exec(migration.slice(0, invitationFunctionStart))
  return db
}

test('valid adult link derives canonical scope and resolves one player context', async () => {
  const db = await createDatabase()
  await setClaims(db, ids.adultUser)

  await db.query(`
    insert into public.adult_player_account_links (user_id, player_id, created_by)
    values ($1, $2, $1)
  `, [ids.adultUser, ids.adultPlayer])

  const result = await db.query('select * from public.get_own_adult_player_account_state()')
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].access_granted, true)
  assert.equal(result.rows[0].access_mode, 'player')
  assert.equal(result.rows[0].role_label, 'Player')
  assert.equal(result.rows[0].player_id, ids.adultPlayer)
  assert.equal(result.rows[0].club_id, ids.club)
  assert.equal(result.rows[0].team_id, ids.team)

  await db.exec('set role authenticated')
  const visibleLinks = await db.query('select player_id from public.adult_player_account_links')
  const visiblePlayers = await db.query('select id from public.players order by id')
  await db.exec('reset role')
  assert.deepEqual(visibleLinks.rows.map((row) => row.player_id), [ids.adultPlayer])
  assert.deepEqual(visiblePlayers.rows.map((row) => row.id), [ids.adultPlayer])
  await db.close()
})

test('under-18, missing DOB, non-self-managed, and cross-club links are denied', async () => {
  const db = await createDatabase()

  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (user_id, player_id, created_by)
      values ($1, $2, $1)
    `, [ids.adultUser, ids.minorPlayer]),
    /under 18/i,
  )

  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (user_id, player_id, created_by)
      values ($1, $2, $1)
    `, [ids.adultUser, ids.missingDobPlayer]),
    /verified date of birth/i,
  )

  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (user_id, player_id, created_by)
      values ($1, $2, $1)
    `, [ids.adultUser, ids.parentManagedPlayer]),
    /self-managed/i,
  )

  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (
        user_id, player_id, club_id, team_id, created_by
      )
      values ($1, $2, $3, $4, $1)
    `, [ids.adultUser, ids.adultPlayer, ids.otherClub, ids.otherTeam]),
    /requested club/i,
  )
  await db.close()
})

test('conflicting identities and duplicate active links are denied', async () => {
  const db = await createDatabase()

  await db.query('insert into public.users (id) values ($1)', [ids.adultUser])
  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (user_id, player_id, created_by)
      values ($1, $2, $1)
    `, [ids.adultUser, ids.adultPlayer]),
    /staff or platform profile/i,
  )
  await db.query('delete from public.users where id = $1', [ids.adultUser])

  await db.query(`
    insert into public.parent_player_links (auth_user_id, player_id, status)
    values ($1, $2, 'active')
  `, [ids.adultUser, ids.adultPlayer])
  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (user_id, player_id, created_by)
      values ($1, $2, $1)
    `, [ids.adultUser, ids.adultPlayer]),
    /active parent access/i,
  )
  await db.query('delete from public.parent_player_links')

  await db.query(`
    insert into public.adult_player_account_links (user_id, player_id, created_by)
    values ($1, $2, $1)
  `, [ids.adultUser, ids.adultPlayer])

  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (user_id, player_id, created_by)
      values ($1, $2, $1)
    `, [ids.adultUser, ids.secondAdultPlayer]),
    /adult_player_account_links_one_active_user_idx/i,
  )

  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (user_id, player_id, created_by)
      values ($1, $2, $1)
    `, [ids.secondAdultUser, ids.adultPlayer]),
    /adult_player_account_links_one_active_player_idx/i,
  )
  await db.close()
})

test('revocation and player lifecycle changes fail closed', async () => {
  const db = await createDatabase()
  await setClaims(db, ids.adultUser)

  const inserted = await db.query(`
    insert into public.adult_player_account_links (user_id, player_id, created_by)
    values ($1, $2, $1)
    returning id
  `, [ids.adultUser, ids.adultPlayer])

  await db.query(`
    update public.adult_player_account_links
    set status = 'revoked', revoked_by = $1
    where id = $2
  `, [ids.adultUser, inserted.rows[0].id])

  let state = await db.query('select * from public.get_own_adult_player_account_state()')
  assert.equal(state.rows[0].access_granted, false)
  assert.equal(state.rows[0].denial_category, 'link_revoked')

  await db.query(`
    update public.adult_player_account_links
    set status = 'active', verified_at = now(), revoked_at = null, revoked_by = null
    where id = $1
  `, [inserted.rows[0].id])
  await db.query("update public.players set status = 'archived', archived_at = now() where id = $1", [
    ids.adultPlayer,
  ])

  state = await db.query('select * from public.get_own_adult_player_account_state()')
  assert.equal(state.rows[0].access_granted, false)
  assert.equal(state.rows[0].denial_category, 'player_inactive')

  await assert.rejects(
    db.query('delete from public.players where id = $1', [ids.adultPlayer]),
    /foreign key/i,
  )
  await db.close()
})

test('invalid auth user is denied by the canonical foreign key', async () => {
  const db = await createDatabase()
  await assert.rejects(
    db.query(`
      insert into public.adult_player_account_links (user_id, player_id)
      values ($1, $2)
    `, [ids.invalidUser, ids.adultPlayer]),
    /foreign key/i,
  )
  await db.close()
})

test('migration keeps adult authority separate from parent and staff identity', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table public\.adult_player_account_links/)
  assert.match(migration, /'player'::text,[\s\S]*'Player'::text/)
  assert.match(migration, /request\.parent_link_id is null[\s\S]*request\.recipient_type = 'player'/)
  assert.match(migration, /request_player\.parent_link_id is null[\s\S]*request_player\.recipient_type = 'player'/)
  assert.match(migration, /'responseSource', 'adult_player'/)
  assert.match(migration, /public\.submit_match_day_availability_response\(/)
  assert.match(migration, /public\.submit_training_availability_response\(/)
  assert.doesNotMatch(migration, /insert into public\.parent_player_links/i)
  assert.doesNotMatch(migration, /role:\s*'parent_portal'/i)
})
