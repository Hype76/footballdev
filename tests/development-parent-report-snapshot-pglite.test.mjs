import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260729160000_development_parent_report_snapshot.sql',
  import.meta.url,
)

test('Development parent report migration is repeatable and stores the finalized snapshot', async () => {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users (
        id uuid primary key
      );
      create table public.clubs (
        id uuid primary key
      );
      create table public.evaluations (
        id uuid primary key default gen_random_uuid()
      );
    `)
    await db.exec(migration)
    await db.exec(migration)

    await db.exec(`
      insert into public.clubs (id)
      values ('11111111-1111-4111-8111-111111111111');

      insert into auth.users (id)
      values ('22222222-2222-4222-8222-222222222222');
    `)

    const inserted = await db.query(`
      insert into public.evaluations default values
      returning id
    `)
    const emptyReport = await db.query(`
      select count(*)::integer as count
      from public.development_parent_reports
      where evaluation_id = $1
    `, [inserted.rows[0].id])
    assert.equal(emptyReport.rows[0].count, 0)

    const report = {
      version: 1,
      responseItems: [
        {
          fieldId: 'technical',
          label: 'Technical',
          rawValue: 8,
          displayValue: '8 / 10 - Very Good',
          parentVisible: true,
          selected: true,
        },
      ],
      emailSections: [],
    }
    const updated = await db.query(
      `
        insert into public.development_parent_reports (
          evaluation_id,
          club_id,
          report_snapshot,
          finalized_by
        )
        values (
          $2,
          '11111111-1111-4111-8111-111111111111',
          $1::jsonb,
          '22222222-2222-4222-8222-222222222222'
        )
        on conflict (evaluation_id) do update
        set report_snapshot = excluded.report_snapshot,
            finalized_at = now(),
            finalized_by = excluded.finalized_by
        returning report_snapshot
      `,
      [JSON.stringify(report), inserted.rows[0].id],
    )

    assert.deepEqual(updated.rows[0].report_snapshot, report)

    const privileges = await db.query(`
      select
        has_table_privilege('authenticated', 'public.development_parent_reports', 'select') as authenticated_select,
        has_table_privilege('authenticated', 'public.development_parent_reports', 'insert') as authenticated_insert,
        has_table_privilege('service_role', 'public.development_parent_reports', 'select') as service_select,
        has_table_privilege('service_role', 'public.development_parent_reports', 'update') as service_update
    `)
    assert.deepEqual(privileges.rows[0], {
      authenticated_select: false,
      authenticated_insert: false,
      service_select: true,
      service_update: true,
    })
  } finally {
    await db.close()
  }
})
