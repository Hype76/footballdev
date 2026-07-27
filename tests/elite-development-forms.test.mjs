import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import {
  buildEliteDevelopmentData,
  getCustomMetricKey,
  isValidEliteRating,
  validateEliteFeedbackFormResponses,
} from '../src/lib/elite-development.js'
import {
  buildFeedbackFormSnapshot,
  canCompleteFeedbackForms,
  canManageFeedbackForms,
  normalizeFeedbackFormField,
  updateFeedbackFormEditorFields,
} from '../src/lib/domain/feedback-forms.js'
import { normalizeFeedbackFormSnapshot } from '../src/lib/domain/evaluation-normalizers.js'
import { normalizeResponseValue } from '../src/hooks/evaluations/evaluationFormUtils.js'
import { getParentVisibleDevelopmentResponses } from '../netlify/functions/lib/_development-parent-email-output.js'

const migrationUrl = new URL('../supabase/migrations/20260727202636_elite_development_forms_batch1.sql', import.meta.url)

function metricField(overrides = {}) {
  const field = normalizeFeedbackFormField({
    id: 'metric-attacking-finishing',
    label: 'Finishing',
    type: 'score_1_10',
    includeInProgressChart: true,
    parentVisible: false,
    metricKey: 'attacking.finishing',
    categoryKey: 'attacking',
    categoryLabel: 'Striking and Attacking',
    ...overrides,
  })
  return Object.prototype.hasOwnProperty.call(overrides, 'value')
    ? { ...field, value: overrides.value }
    : field
}

function evaluation({
  date,
  id,
  fields,
  formName = 'Elite Attacking Review',
}) {
  return {
    id,
    date,
    feedbackFormId: '11111111-1111-4111-8111-111111111111',
    feedbackFormName: formName,
    feedbackFormSnapshot: {
      formId: '11111111-1111-4111-8111-111111111111',
      formName,
      formVersion: 1,
      fields,
    },
  }
}

test('elite score validation accepts only whole numbers from 1 through 10', () => {
  for (let value = 1; value <= 10; value += 1) {
    assert.equal(isValidEliteRating(value), true)
    assert.equal(normalizeResponseValue(metricField(), String(value)), value)
  }

  for (const value of [0, 11, -1, 1.5, 'invalid']) {
    assert.equal(isValidEliteRating(value), false)
    assert.equal(normalizeResponseValue(metricField(), value), '')
    assert.throws(
      () => validateEliteFeedbackFormResponses(
        { fields: [metricField()] },
        { Finishing: value },
      ),
      /whole-number rating from 1 to 10/,
    )
  }
})

test('manager access and coach completion preserve the current named-form permission model', () => {
  const base = {
    clubId: 'club-1',
    activeTeamId: 'team-1',
    planStatus: 'active',
  }
  assert.equal(canManageFeedbackForms({ ...base, role: 'manager', roleRank: 50 }), true)
  assert.equal(canManageFeedbackForms({ ...base, role: 'coach', roleRank: 30 }), false)
  assert.equal(canCompleteFeedbackForms({ ...base, role: 'coach', roleRank: 30 }), true)
  assert.equal(canCompleteFeedbackForms({ ...base, role: 'parent_portal', roleRank: 0 }), false)
})

test('field label edits retain stable metric identity and historical snapshots retain old labels', () => {
  const original = metricField()
  const oldSnapshot = buildFeedbackFormSnapshot({
    form: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Elite Attacking Review',
      version: 1,
      fields: [original],
    },
    formResponses: { Finishing: 6 },
  })
  const [renamed] = updateFeedbackFormEditorFields([original], original.id, { label: 'Finishing quality' })
  const newSnapshot = buildFeedbackFormSnapshot({
    form: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Elite Attacking Review',
      version: 2,
      fields: [renamed],
    },
    formResponses: { 'Finishing quality': 8 },
  })

  assert.equal(oldSnapshot.fields[0].label, 'Finishing')
  assert.equal(oldSnapshot.fields[0].value, 6)
  assert.equal(newSnapshot.fields[0].label, 'Finishing quality')
  assert.equal(oldSnapshot.fields[0].metricKey, newSnapshot.fields[0].metricKey)
  assert.equal(newSnapshot.fields[0].metricKey, 'attacking.finishing')
})

test('custom score fields receive a stable custom identity and deliberate type replacement clears it', () => {
  const field = normalizeFeedbackFormField({
    id: 'custom-field-1',
    label: 'Custom score',
    type: 'score_1_10',
    includeInProgressChart: true,
  })
  assert.equal(field.metricKey, getCustomMetricKey('custom-field-1'))

  const [replaced] = updateFeedbackFormEditorFields([field], field.id, { type: 'textarea' })
  assert.equal(replaced.metricKey, '')
  assert.equal(replaced.includeInProgressChart, false)

  const chartDisabled = normalizeFeedbackFormField({
    ...field,
    includeInProgressChart: false,
  })
  assert.equal(chartDisabled.metricKey, '')
  assert.equal(chartDisabled.categoryKey, '')
})

test('metric and category series are chronological, exclude unanswered values and preserve zero as invalid', () => {
  const data = buildEliteDevelopmentData([
    evaluation({
      id: 'later',
      date: '20/07/2026',
      fields: [
        metricField({ value: 8 }),
        metricField({
          id: 'metric-attacking-composure',
          label: 'Composure',
          metricKey: 'attacking.composure',
          value: '',
        }),
        metricField({
          id: 'metric-attacking-movement',
          label: 'Attacking movement',
          metricKey: 'attacking.movement',
          value: 0,
        }),
      ],
    }),
    evaluation({
      id: 'earlier',
      date: '10/07/2026',
      fields: [
        metricField({ value: 6 }),
        metricField({
          id: 'metric-attacking-composure',
          label: 'Composure',
          metricKey: 'attacking.composure',
          value: 4,
        }),
      ],
    }),
  ])

  assert.deepEqual(data.metricSeries.find((series) => series.key === 'attacking.finishing').points.map((point) => point.value), [6, 8])
  assert.deepEqual(data.categorySeries[0].points.map((point) => point.value), [5, 8])
  assert.deepEqual(data.categorySeries[0].points.map((point) => point.answeredMetricCount), [2, 1])
  assert.deepEqual(data.previousComparison.changes, [{
    metricKey: 'attacking.finishing',
    label: 'Finishing',
    previous: 6,
    latest: 8,
    change: 2,
  }])
})

test('stable metric identity joins compatible history after a visible label change', () => {
  const data = buildEliteDevelopmentData([
    evaluation({ id: 'one', date: '2026-07-10', fields: [metricField({ value: 6 })] }),
    evaluation({
      id: 'two',
      date: '2026-07-20',
      fields: [metricField({ label: 'Finishing quality', value: 8 })],
    }),
  ])
  assert.equal(data.metricSeries.length, 1)
  assert.equal(data.metricSeries[0].label, 'Finishing quality')
  assert.deepEqual(data.metricSeries[0].points.map((point) => point.fieldLabel), ['Finishing', 'Finishing quality'])
})

test('snapshot normalization retains metric, category, visibility and platform provenance', () => {
  const snapshot = normalizeFeedbackFormSnapshot({
    formId: null,
    templateKey: 'elite-attacking-review',
    formName: 'Elite Attacking Review',
    formVersion: 1,
    isPlatformTemplate: true,
    fields: [metricField({ value: 7 })],
  })
  assert.equal(snapshot.templateKey, 'elite-attacking-review')
  assert.equal(snapshot.isPlatformTemplate, true)
  assert.equal(snapshot.fields[0].metricKey, 'attacking.finishing')
  assert.equal(snapshot.fields[0].categoryKey, 'attacking')
  assert.equal(snapshot.fields[0].parentVisible, false)
})

test('parent output includes approved summary and hides private staff notes and elite metrics', () => {
  const evaluationRow = {
    form_responses: {
      'Parent-visible summary': 'Working with confidence.',
      'Private staff notes': 'Staff only detail.',
      Finishing: 8,
    },
    feedback_form_snapshot: {
      fields: [
        { id: 'summary', label: 'Parent-visible summary', type: 'textarea', parentVisible: true },
        { id: 'private', label: 'Private staff notes', type: 'textarea', parentVisible: false },
        metricField({ value: 8 }),
      ],
    },
  }
  const visible = getParentVisibleDevelopmentResponses(evaluationRow, [
    { label: 'Parent-visible summary', value: 'Working with confidence.' },
    { label: 'Private staff notes', value: 'Staff only detail.' },
    { label: 'Finishing', value: 8 },
  ])
  assert.deepEqual(visible, [{ label: 'Parent-visible summary', value: 'Working with confidence.' }])
})

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create schema app_private;

    create table public.feedback_forms (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      name text not null,
      fields jsonb not null default '[]'::jsonb,
      status text not null default 'active',
      version integer not null default 1
    );

    create table public.evaluations (
      id uuid primary key default gen_random_uuid(),
      feedback_form_snapshot jsonb not null default '{}'::jsonb
    );

    create table public.feedback_form_starter_templates (
      template_key text not null,
      version integer not null,
      age_band text not null,
      age_min integer not null,
      age_max integer not null,
      name text not null,
      description text not null,
      fields jsonb not null default '[]'::jsonb,
      is_current boolean not null default false,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      primary key (template_key, version)
    );

    create unique index feedback_form_starter_templates_one_current_idx
    on public.feedback_form_starter_templates (template_key)
    where is_current;
  `)
  return db
}

test('migration installs six additive elite templates with exact metric coverage and no team data rewrite', async () => {
  const db = await createDatabase()
  const migration = await readFile(migrationUrl, 'utf8')
  const existingFormId = '11111111-1111-4111-8111-111111111111'
  const existingEvaluationId = '22222222-2222-4222-8222-222222222222'

  await db.query(`
    insert into public.feedback_forms(id, club_id, team_id, name, fields)
    values ($1, '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'Existing ordinary form', '[]'::jsonb)
  `, [existingFormId])
  await db.query(`
    insert into public.evaluations(id, feedback_form_snapshot)
    values ($1, '{"formName":"Historical form","fields":[{"id":"old","label":"Old score","type":"score_1_10","value":0}]}'::jsonb)
  `, [existingEvaluationId])

  await db.exec(migration)
  await db.exec(migration)

  const catalogue = await db.query(`
    select
      count(*)::integer as form_count,
      count(*) filter (where is_current)::integer as current_count,
      min(jsonb_array_length(fields))::integer as minimum_fields,
      max(jsonb_array_length(fields))::integer as maximum_fields
    from public.feedback_form_starter_templates
    where template_key like 'elite-%'
  `)
  assert.deepEqual(catalogue.rows[0], {
    form_count: 6,
    current_count: 6,
    minimum_fields: 20,
    maximum_fields: 60,
  })

  const metrics = await db.query(`
    select
      count(*)::integer as metric_count,
      count(distinct field ->> 'metricKey')::integer as distinct_metric_count,
      count(*) filter (
        where field ->> 'type' = 'score_1_10'
          and (field -> 'options') ? '1'
          and (field -> 'options') ? '10'
      )::integer as valid_score_field_count
    from public.feedback_form_starter_templates template
    cross join lateral jsonb_array_elements(template.fields) field
    where template.template_key = 'elite-complete-player-review'
      and field ? 'metricKey'
  `)
  assert.deepEqual(metrics.rows[0], {
    metric_count: 50,
    distinct_metric_count: 50,
    valid_score_field_count: 50,
  })

  const existing = await db.query(`
    select
      (select name from public.feedback_forms where id = $1) as form_name,
      (select feedback_form_snapshot ->> 'formName' from public.evaluations where id = $2) as snapshot_name
  `, [existingFormId, existingEvaluationId])
  assert.deepEqual(existing.rows[0], {
    form_name: 'Existing ordinary form',
    snapshot_name: 'Historical form',
  })

  await db.close()
})

test('database checks reject forged elite metadata and invalid submitted scores', async () => {
  const db = await createDatabase()
  const migration = await readFile(migrationUrl, 'utf8')
  await db.exec(migration)

  await assert.rejects(
    db.query(`
      insert into public.feedback_forms(club_id, team_id, name, fields)
      values (
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        'Forged metric form',
        '[{"id":"wrong","label":"Forged","type":"score_1_10","includeInProgressChart":true,"metricKey":"attacking.unknown","categoryKey":"attacking"}]'::jsonb
      )
    `),
    /feedback_forms_elite_field_metadata_check/,
  )

  for (const invalidValue of ['0', '11', '-1', '1.5', '"invalid"']) {
    await assert.rejects(
      db.query(`
        insert into public.evaluations(feedback_form_snapshot)
        values (
          jsonb_build_object(
            'fields',
            jsonb_build_array(
              jsonb_build_object(
                'id', 'metric-attacking-finishing',
                'label', 'Finishing',
                'type', 'score_1_10',
                'metricKey', 'attacking.finishing',
                'categoryKey', 'attacking',
                'value', '${invalidValue}'::jsonb
              )
            )
          )
        )
      `),
      /evaluations_elite_snapshot_scores_check/,
    )
  }

  for (let score = 1; score <= 10; score += 1) {
    await db.query(`
      insert into public.evaluations(feedback_form_snapshot)
      values (
        jsonb_build_object(
          'fields',
          jsonb_build_array(
            jsonb_build_object(
              'id', 'metric-attacking-finishing',
              'label', 'Finishing',
              'type', 'score_1_10',
              'metricKey', 'attacking.finishing',
              'categoryKey', 'attacking',
              'value', $1::integer
            )
          )
        )
      )
    `, [score])
  }

  const accepted = await db.query('select count(*)::integer as count from public.evaluations')
  assert.equal(accepted.rows[0].count, 10)
  await db.close()
})

test('active starter provenance prevents accidental duplicate installation but allows archived history', async () => {
  const db = await createDatabase()
  const migration = await readFile(migrationUrl, 'utf8')
  await db.exec(migration)

  const scope = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ]
  await db.query(`
    insert into public.feedback_forms(club_id, team_id, name, fields, starter_template_key, starter_template_version)
    values ($1, $2, 'Elite Attacking Review', '[]'::jsonb, 'elite-attacking-review', 1)
  `, scope)
  await assert.rejects(
    db.query(`
      insert into public.feedback_forms(club_id, team_id, name, fields, starter_template_key, starter_template_version)
      values ($1, $2, 'Duplicate', '[]'::jsonb, 'elite-attacking-review', 1)
    `, scope),
    /feedback_forms_one_active_starter_per_team_idx/,
  )
  await db.query(`
    update public.feedback_forms
    set status = 'archived'
    where team_id = $1 and starter_template_key = 'elite-attacking-review'
  `, [scope[1]])
  await db.query(`
    insert into public.feedback_forms(club_id, team_id, name, fields, starter_template_key, starter_template_version)
    values ($1, $2, 'Elite Attacking Review reinstalled', '[]'::jsonb, 'elite-attacking-review', 1)
  `, scope)

  const rows = await db.query(`
    select status, name
    from public.feedback_forms
    where team_id = $1 and starter_template_key = 'elite-attacking-review'
    order by name
  `, [scope[1]])
  assert.deepEqual(rows.rows, [
    { status: 'archived', name: 'Elite Attacking Review' },
    { status: 'active', name: 'Elite Attacking Review reinstalled' },
  ])
  await db.close()
})

test('candidate preserves ordinary named forms and contains no communication or Platform Admin analytics implementation', async () => {
  const [domainSource, formPageSource, playerPageSource, migration] = await Promise.all([
    readFile(new URL('../src/lib/domain/feedback-forms.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/FeedbackFormsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/PlayerProfile.jsx', import.meta.url), 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])

  assert.match(domainSource, /createFeedbackForm/)
  assert.match(domainSource, /duplicateFeedbackForm/)
  assert.match(domainSource, /archiveFeedbackForm/)
  assert.match(formPageSource, /Create form/)
  assert.match(formPageSource, /Parent visible/)
  assert.match(playerPageSource, /EliteDevelopmentCharts/)
  assert.doesNotMatch(migration, /send_email|email_queue|push_notification|sms|invitation/i)
  assert.doesNotMatch(
    `${domainSource}\n${formPageSource}\n${playerPageSource}\n${migration}`,
    /platform[_ -]analytics|PlatformAnalyticsSection|platform-analytics/i,
  )
})
