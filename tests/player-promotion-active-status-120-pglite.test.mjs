import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const coreUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const playerDetailsUrl = new URL('../src/components/players/PlayerDetailsSection.jsx', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260827111500_player_promotion_active_status.sql', import.meta.url)

test('promoting a Trial player makes the Squad player active while retaining promotion audit fields', async () => {
  const [core, details] = await Promise.all([
    readFile(coreUrl, 'utf8'),
    readFile(playerDetailsUrl, 'utf8'),
  ])
  const start = core.indexOf('export async function promotePlayerToSquad')
  const end = core.indexOf('export async function movePlayerToTrial', start)
  const promotion = core.slice(start, end)

  assert.match(promotion, /section:\s*'Squad',[\s\S]*status:\s*'active'/)
  assert.match(promotion, /promoted_at:\s*promotedAt/)
  assert.match(promotion, /promoted_by:\s*user\.id/)
  assert.doesNotMatch(promotion, /status:\s*'promoted'/)
  assert.match(details, /player\.status === 'archived' \? 'Archived' : 'Active'/)
})

test('promotion reconciliation updates only current promoted Squad players without deleting records', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema if not exists public;
      create table public.players (
        id integer primary key,
        section text not null,
        status text not null,
        archived_at timestamptz,
        promoted_at timestamptz,
        promoted_by uuid,
        updated_at timestamptz not null default now()
      );
      insert into public.players (id, section, status, archived_at, promoted_at)
      values
        (1, 'Squad', 'promoted', null, now() - interval '1 day'),
        (2, 'Trial', 'promoted', null, now() - interval '1 day'),
        (3, 'Squad', 'active', null, null),
        (4, 'Squad', 'promoted', now() - interval '1 hour', now() - interval '1 day');
    `)
    const before = await db.query('select count(*)::int as row_count from public.players')
    await db.exec(await readFile(migrationUrl, 'utf8'))
    const after = await db.query('select count(*)::int as row_count from public.players')
    assert.deepEqual(after.rows, before.rows)

    const rows = await db.query(`
      select id, section, status, archived_at is not null as archived, promoted_at is not null as has_promotion_audit
      from public.players
      order by id
    `)
    assert.deepEqual(rows.rows, [
      { archived: false, has_promotion_audit: true, id: 1, section: 'Squad', status: 'active' },
      { archived: false, has_promotion_audit: true, id: 2, section: 'Trial', status: 'promoted' },
      { archived: false, has_promotion_audit: false, id: 3, section: 'Squad', status: 'active' },
      { archived: true, has_promotion_audit: true, id: 4, section: 'Squad', status: 'promoted' },
    ])
  } finally {
    await db.close()
  }
})
