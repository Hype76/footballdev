import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260723152244_fp_v1_finish_polish_combined_14.sql', import.meta.url)

async function createStarterTemplateDatabase() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create schema app_private;

    create table public.clubs (
      id uuid primary key
    );

    create table public.users (
      id uuid primary key
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs (id) on delete cascade,
      age_group text
    );

    create table public.team_staff (
      team_id uuid not null references public.teams (id) on delete cascade,
      user_id uuid not null references public.users (id) on delete cascade,
      primary key (team_id, user_id)
    );

    create function auth.uid()
    returns uuid
    language sql
    stable
    as 'select null::uuid';

    create function public.current_user_club_id()
    returns uuid
    language sql
    stable
    as 'select null::uuid';

    create function public.current_user_role()
    returns text
    language sql
    stable
    as 'select ''coach''::text';

    create function public.current_user_role_rank()
    returns integer
    language sql
    stable
    as 'select 30';

    create function public.can_use_plan_feature(uuid, text)
    returns boolean
    language sql
    stable
    as 'select true';

    create role anon;
    create role authenticated;
  `)
  return db
}

test('starter template migration applies twice without duplicates and preserves versioned field quality', async () => {
  const db = await createStarterTemplateDatabase()
  const migration = await readFile(migrationUrl, 'utf8')

  await db.exec(migration)
  await db.exec(migration)

  const catalogue = await db.query(`
    select
      count(*)::integer as template_count,
      count(*) filter (where is_current)::integer as current_count,
      min(jsonb_array_length(fields))::integer as minimum_fields,
      max(jsonb_array_length(fields))::integer as maximum_fields
    from public.feedback_form_starter_templates
  `)
  assert.deepEqual(catalogue.rows[0], {
    template_count: 9,
    current_count: 9,
    minimum_fields: 15,
    maximum_fields: 21,
  })

  const quality = await db.query(`
    select
      count(*) filter (
        where field ->> 'type' = 'select'
          and (field -> 'options') ? 'Not observed'
          and coalesce((field ->> 'includeInProgressChart')::boolean, false) = false
      )::integer as safe_observation_count,
      count(*) filter (
        where field ->> 'type' = 'select'
          and (field -> 'options') ? '10'
      )::integer as ten_point_count
    from public.feedback_form_starter_templates template
    cross join lateral jsonb_array_elements(template.fields) field
    where template.is_current
  `)
  assert.ok(quality.rows[0].safe_observation_count > 0)
  assert.equal(quality.rows[0].ten_point_count, 0)

  const preferenceColumns = await db.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'feedback_form_starter_preferences'
    order by ordinal_position
  `)
  assert.deepEqual(preferenceColumns.rows.map((row) => row.column_name), [
    'club_id',
    'team_id',
    'template_key',
    'hidden',
    'updated_by',
    'created_at',
    'updated_at',
  ])

  await db.close()
})
