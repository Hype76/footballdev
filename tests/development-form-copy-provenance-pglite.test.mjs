import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260728104901_development_form_copy_provenance.sql',
  import.meta.url,
)

test('copy provenance rejects cross-team and invalid platform sources without rewriting history', async () => {
  const db = new PGlite()
  await db.exec(`
    create schema app_private;
    create table public.feedback_form_starter_templates (
      id uuid primary key,
      template_key text not null,
      version integer not null,
      unique (template_key, version)
    );
    create table public.feedback_forms (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      name text not null,
      fields jsonb not null default '[]'::jsonb,
      status text not null default 'active',
      starter_template_key text,
      starter_template_version integer,
      duplicated_from_id uuid references public.feedback_forms(id) on delete set null
    );
    create table public.evaluations (
      id uuid primary key,
      feedback_form_snapshot jsonb not null default '{}'::jsonb
    );
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))

  const clubA = '11111111-1111-4111-8111-111111111111'
  const clubB = '22222222-2222-4222-8222-222222222222'
  const teamA = '33333333-3333-4333-8333-333333333333'
  const teamB = '44444444-4444-4444-8444-444444444444'
  const teamC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const sourceA = '55555555-5555-4555-8555-555555555555'
  const sourceB = '66666666-6666-4666-8666-666666666666'
  const sourceC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const templateId = '77777777-7777-4777-8777-777777777777'
  const evaluationId = '88888888-8888-4888-8888-888888888888'

  await db.query(
    `insert into public.feedback_form_starter_templates(id, template_key, version)
     values ($1, 'platform-review', 4)`,
    [templateId],
  )
  await db.query(
    `insert into public.feedback_forms(id, club_id, team_id, name, fields)
     values
       ($1, $2, $3, 'Team A source', '[{"label":"Original"}]'::jsonb),
       ($4, $5, $6, 'Other club source', '[{"label":"Other club"}]'::jsonb),
       ($7, $2, $8, 'Other team source', '[{"label":"Other team"}]'::jsonb)`,
    [sourceA, clubA, teamA, sourceB, clubB, teamB, sourceC, teamC],
  )
  await db.query(
    `insert into public.evaluations(id, feedback_form_snapshot)
     values ($1, '{"formName":"Historical form","templateKey":"platform-review","formVersion":4,"fields":[{"label":"Old label","value":"Green"}]}'::jsonb)`,
    [evaluationId],
  )

  await db.query(
    `insert into public.feedback_forms(
       id, club_id, team_id, name, fields, duplicated_from_id, source_template_key, source_template_version
     )
     values (
       '99999999-9999-4999-8999-999999999999', $1, $2, 'Valid copy',
       '[{"label":"Original"}]'::jsonb, $3, 'platform-review', 4
     )`,
    [clubA, teamA, sourceA],
  )

  await assert.rejects(
    db.query(
      `insert into public.feedback_forms(
         id, club_id, team_id, name, fields, duplicated_from_id
       )
       values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, $2, 'Cross-team copy', '[]'::jsonb, $3)`,
      [clubA, teamA, sourceB],
    ),
    /outside the authorised team scope/,
  )
  await assert.rejects(
    db.query(
      `insert into public.feedback_forms(
         id, club_id, team_id, name, fields, duplicated_from_id
       )
       values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', $1, $2, 'Cross-team copy', '[]'::jsonb, $3)`,
      [clubA, teamA, sourceC],
    ),
    /outside the authorised team scope/,
  )
  await assert.rejects(
    db.query(
      `insert into public.feedback_forms(
         id, club_id, team_id, name, fields, source_template_key, source_template_version
       )
       values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, $2, 'Invalid template', '[]'::jsonb, 'platform-review', 99)`,
      [clubA, teamA],
    ),
    /source key and version are invalid/,
  )

  const history = await db.query(
    `select feedback_form_snapshot from public.evaluations where id = $1`,
    [evaluationId],
  )
  assert.deepEqual(history.rows[0].feedback_form_snapshot, {
    fields: [{ label: 'Old label', value: 'Green' }],
    formName: 'Historical form',
    formVersion: 4,
    templateKey: 'platform-review',
  })
  const source = await db.query(
    `select name, fields from public.feedback_forms where id = $1`,
    [sourceA],
  )
  assert.deepEqual(source.rows[0], {
    fields: [{ label: 'Original' }],
    name: 'Team A source',
  })
  await db.close()
})
