import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrls = [
  new URL(
    '../supabase/migrations/20260823161252_coach_mobile_auto_parent_portal_invite.sql',
    import.meta.url,
  ),
  new URL(
    '../supabase/migrations/20260823163137_coach_mobile_auto_parent_portal_invite_enable.sql',
    import.meta.url,
  ),
]

const IDS = {
  actor: '10000000-0000-4000-8000-000000000001',
  club: '20000000-0000-4000-8000-000000000001',
  team: '30000000-0000-4000-8000-000000000001',
}

const schemaSql = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('email', current_setting('request.jwt.claim.email', true));
$$;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  team_id uuid,
  player_name text not null,
  section text not null default 'Trial',
  status text not null default 'active',
  archived_at timestamptz,
  contact_type text not null default 'parent',
  parent_contacts jsonb not null default '[]'::jsonb,
  parent_email text,
  parent_name text,
  created_by_email text,
  created_by_name text
);

create table public.parent_player_links (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  team_id uuid,
  player_id uuid not null,
  link_type text not null default 'parent',
  email text,
  auth_user_id uuid,
  invite_token uuid not null default gen_random_uuid(),
  status text not null default 'pending',
  expires_at timestamptz,
  invite_sent_at timestamptz,
  invited_by uuid,
  invited_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index parent_player_links_unique_email
on public.parent_player_links (team_id, player_id, lower(coalesce(email, '')), link_type)
where email is not null and status <> 'revoked';

create table public.scheduled_email_queue (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  team_id uuid,
  created_by uuid,
  created_by_email text not null default '',
  to_email text not null,
  subject text not null default '',
  status text not null default 'scheduled',
  scheduled_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  retry_enabled boolean not null default true,
  legacy_review_required boolean not null default false
);

create function public.current_user_role()
returns text language sql stable as $$ select 'coach'::text $$;

create function public.current_user_can_access_team(uuid, uuid)
returns boolean language sql stable as $$ select true $$;

create function public.can_manage_parent_link(uuid)
returns boolean language sql stable as $$ select true $$;

create function public.can_use_plan_feature(uuid, text)
returns boolean language sql stable as $$ select true $$;
`

async function setMobileRequest(db, clientInfo = 'supabase-js-react-native/2.102.1') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [IDS.actor])
  await db.query("select set_config('request.jwt.claim.email', 'coach@example.test', false)")
  await db.query(
    "select set_config('request.headers', $1, false)",
    [JSON.stringify({ 'x-client-info': clientInfo })],
  )
}

async function applyMigrations(db) {
  for (const migrationUrl of migrationUrls) {
    await db.exec(await readFile(migrationUrl, 'utf8'))
  }
}

async function insertPlayer(db, {
  contactType = 'parent',
  contacts = [{ email: 'parent@example.test', name: 'Parent', type: 'parent' }],
  email = 'parent@example.test',
  name = 'New Player',
  section = 'Squad',
} = {}) {
  const result = await db.query(
    `insert into public.players(
       club_id, team_id, player_name, section, status, contact_type,
       parent_contacts, parent_email, parent_name, created_by_email, created_by_name
     ) values ($1, $2, $3, $4, 'active', $5, $6::jsonb, $7, 'Parent', 'coach@example.test', 'Test Coach')
     returning id`,
    [IDS.club, IDS.team, name, section, contactType, JSON.stringify(contacts), email],
  )
  return result.rows[0].id
}

test('Coach mobile Squad creation queues one Parent Portal invite per parent email', async () => {
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await applyMigrations(db)
    await setMobileRequest(db)
    const playerId = await insertPlayer(db, {
      contacts: [
        { email: 'PARENT@example.test', name: 'Parent One', type: 'parent' },
        { email: 'parent@example.test', name: 'Duplicate', type: 'parent' },
      ],
    })

    const links = await db.query(
      'select * from public.parent_player_links where player_id = $1',
      [playerId],
    )
    const queue = await db.query(
      "select * from public.scheduled_email_queue where payload #>> '{parentPortalInvite,playerId}' = $1",
      [playerId],
    )

    assert.equal(links.rows.length, 1)
    assert.equal(links.rows[0].email, 'parent@example.test')
    assert.equal(links.rows[0].status, 'pending')
    assert.equal(queue.rows.length, 1)
    assert.equal(queue.rows[0].to_email, 'parent@example.test')
    assert.equal(queue.rows[0].retry_enabled, true)
    assert.equal(queue.rows[0].legacy_review_required, false)
    assert.equal(queue.rows[0].payload.parentPortalInvite.type, 'coach_mobile_new_player')
    assert.equal(queue.rows[0].payload.parentPortalInvite.linkId, links.rows[0].id)
    assert.equal(queue.rows[0].payload.outputKey, `parent-portal-invite:${links.rows[0].id}`)
    assert.equal(JSON.stringify(queue.rows[0].payload).includes(links.rows[0].invite_token), false)
  } finally {
    await db.close()
  }
})

test('web, Trial, self, and invalid Parent contacts do not queue automatic invites', async () => {
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await applyMigrations(db)

    await setMobileRequest(db, 'supabase-js-web/2.110.8')
    await insertPlayer(db, { name: 'Web Player' })

    await setMobileRequest(db)
    await insertPlayer(db, { name: 'Trial Player', section: 'Trial' })
    await insertPlayer(db, { contactType: 'self', name: 'Self Player' })
    await insertPlayer(db, {
      contactType: 'both',
      contacts: [{ email: 'player@example.test', name: 'Player', type: 'self' }],
      email: 'player@example.test',
      name: 'Both Self Player',
    })
    await insertPlayer(db, {
      contacts: [{ email: 'invalid', name: 'Parent', type: 'parent' }],
      email: 'invalid',
      name: 'Invalid Email Player',
    })

    const links = await db.query('select count(*)::integer as count from public.parent_player_links')
    const queue = await db.query('select count(*)::integer as count from public.scheduled_email_queue')
    assert.equal(links.rows[0].count, 0)
    assert.equal(queue.rows[0].count, 0)
  } finally {
    await db.close()
  }
})

test('email queue failure never rolls back Coach mobile Player creation', async () => {
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await applyMigrations(db)
    await db.exec(`
      create function public.reject_test_queue_insert()
      returns trigger language plpgsql as $$
      begin
        raise exception 'test queue unavailable';
      end;
      $$;
      create trigger reject_test_queue_insert
      before insert on public.scheduled_email_queue
      for each row execute function public.reject_test_queue_insert();
    `)
    await setMobileRequest(db)
    const playerId = await insertPlayer(db, { name: 'Surviving Player' })

    const player = await db.query('select id from public.players where id = $1', [playerId])
    const links = await db.query('select count(*)::integer as count from public.parent_player_links')
    assert.equal(player.rows[0].id, playerId)
    assert.equal(links.rows[0].count, 0)
  } finally {
    await db.close()
  }
})
