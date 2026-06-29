import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { canManageFeedbackForms as canManageFeedbackFormsFromAuth } from '../src/lib/auth-permissions.js'
import {
  buildFeedbackFormSnapshot,
  canManageFeedbackForms,
  getUsableFeedbackFormFields,
  normalizeFeedbackFormField,
  validateFeedbackFormDraft,
} from '../src/lib/domain/feedback-forms.js'
import { normalizeEvaluationRow } from '../src/lib/domain/evaluation-normalizers.js'
import { createEvaluationPayload } from '../src/hooks/evaluations/evaluationFormUtils.js'

const clubId = '11111111-1111-4111-8111-111111111111'
const teamId = '22222222-2222-4222-8222-222222222222'
const coachId = '33333333-3333-4333-8333-333333333333'
const feedbackFormId = '44444444-4444-4444-8444-444444444444'

function user(overrides = {}) {
  return {
    activeTeamId: teamId,
    clubId,
    email: 'manager@example.com',
    id: coachId,
    isPlanComped: true,
    name: 'Manager One',
    planKey: 'small_club',
    planStatus: 'active',
    role: 'manager',
    roleRank: 50,
    ...overrides,
  }
}

test('only Manager and Team Admin style staff can manage named feedback forms', () => {
  assert.equal(canManageFeedbackForms(user({ role: 'manager', roleRank: 50 })), true)
  assert.equal(canManageFeedbackFormsFromAuth(user({ role: 'head_manager', roleRank: 70 })), true)
  assert.equal(canManageFeedbackForms(user({ role: 'coach', roleRank: 30 })), false)
  assert.equal(canManageFeedbackForms(user({ role: 'assistant_coach', roleRank: 20 })), false)
  assert.equal(canManageFeedbackFormsFromAuth(user({ role: 'admin', roleRank: 90 })), false)
  assert.equal(canManageFeedbackForms(user({ role: 'parent_portal', roleRank: 0 })), false)
})

test('feedback form draft validation rejects blank names and unusable fields', () => {
  assert.throws(
    () => validateFeedbackFormDraft({ name: '   ', fields: [{ label: 'Overall', type: 'text' }] }),
    /Enter a form name/,
  )
  assert.throws(
    () => validateFeedbackFormDraft({ name: 'Match day', fields: [{ label: '', type: 'text' }] }),
    /at least one usable field/,
  )
  assert.throws(
    () => validateFeedbackFormDraft({ name: 'Match day', fields: [{ label: 'Outcome', type: 'select', options: [] }] }),
    /dropdown option/,
  )
})

test('V1 named feedback fields normalize to practical supported types', () => {
  assert.deepEqual(normalizeFeedbackFormField({ label: 'Rating', type: 'score_1_10' }).options, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
  assert.deepEqual(normalizeFeedbackFormField({ label: 'Available', type: 'yes_no' }).options, ['Yes', 'No'])
  assert.deepEqual(normalizeFeedbackFormField({ label: 'Risk', type: 'traffic_light' }).options, ['Green', 'Amber', 'Red'])
  assert.deepEqual(
    getUsableFeedbackFormFields([
      { id: 'b', label: 'Second', type: 'text', orderIndex: 2 },
      { id: 'a', label: 'First', type: 'text', orderIndex: 1 },
      { id: 'blank', label: '', type: 'text', orderIndex: 3 },
    ]).map((field) => field.label),
    ['First', 'Second'],
  )
})

test('submitted feedback form snapshot preserves labels, version, and values', () => {
  const form = {
    id: feedbackFormId,
    name: 'Goalkeeper review',
    version: 3,
    fields: [
      { id: 'handling', label: 'Handling', type: 'score_1_10', required: true, orderIndex: 1 },
      { id: 'distribution', label: 'Distribution note', type: 'textarea', required: false, orderIndex: 2 },
    ],
  }
  const snapshot = buildFeedbackFormSnapshot({
    form,
    formResponses: {
      Handling: 8,
      'Distribution note': 'Quick release.',
    },
  })

  assert.equal(snapshot.formName, 'Goalkeeper review')
  assert.equal(snapshot.formVersion, 3)
  assert.deepEqual(snapshot.fields.map((field) => [field.label, field.value]), [
    ['Handling', 8],
    ['Distribution note', 'Quick release.'],
  ])
})

test('evaluation payload and row keep submitted form identity for history', () => {
  const feedbackFormSnapshot = {
    formId: feedbackFormId,
    formName: 'Match day feedback',
    formVersion: 2,
    fields: [
      { id: 'impact', label: 'Impact', type: 'traffic_light', value: 'Green' },
    ],
  }
  const payload = createEvaluationPayload({
    assessmentSessionId: '',
    availableTeams: [{ id: teamId, name: 'U12' }],
    averageScore: null,
    comments: { strengths: '', improvements: '', overall: '', selectedStrengths: [] },
    editingEvaluation: null,
    feedbackForm: { id: feedbackFormId, name: 'Match day feedback', version: 2 },
    feedbackFormSnapshot,
    formData: {
      coachName: 'Coach One',
      contactType: 'parent',
      parentContacts: [],
      playerName: 'Ava Green',
      section: 'Squad',
      session: '2026-06-29',
      team: 'U12',
    },
    formResponses: { Impact: 'Green' },
    id: '',
    normalizedContactType: 'parent',
    parentContacts: [],
    savedPlayers: [],
    scores: {},
    user: user({ role: 'coach', roleRank: 30 }),
  })

  const row = normalizeEvaluationRow({
    id: 'row-1',
    club_id: clubId,
    coach_id: coachId,
    date: payload.date,
    feedback_form_id: payload.feedbackFormId,
    feedback_form_name: payload.feedbackFormName,
    feedback_form_version: payload.feedbackFormVersion,
    feedback_form_snapshot: payload.feedbackFormSnapshot,
    form_responses: payload.formResponses,
    player_name: payload.playerName,
    team: payload.team,
  })

  assert.equal(row.feedbackFormId, feedbackFormId)
  assert.equal(row.feedbackFormName, 'Match day feedback')
  assert.equal(row.feedbackFormSnapshot.fields[0].value, 'Green')
})

test('named feedback forms route, navigation, and migration stay manager scoped', async () => {
  const [routerSource, sidebarSource, navigationSource, migrationSource] = await Promise.all([
    readFile(new URL('../src/app/router.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/layout/Sidebar.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/navigation.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260629120000_v1_named_feedback_forms.sql', import.meta.url), 'utf8'),
  ])

  assert.match(routerSource, /function RequireFeedbackFormsAccess/)
  assert.match(routerSource, /canManageFeedbackForms\(user\)/)
  assert.match(navigationSource, /path: '\/feedback-forms'/)
  assert.match(sidebarSource, /canManageFeedbackForms\(displayUser\)/)
  assert.match(migrationSource, /create table if not exists public\.feedback_forms/)
  assert.match(migrationSource, /revoke all on public\.feedback_forms from anon/)
  assert.match(migrationSource, /grant select, insert, update on public\.feedback_forms to authenticated/)
  assert.doesNotMatch(migrationSource, /grant\s+delete\s+on public\.feedback_forms to authenticated/i)
  assert.match(migrationSource, /public\.current_user_role_rank\(\) >= 50/)
  assert.match(migrationSource, /public\.current_user_role\(\) not in \('admin', 'parent_portal', 'super_admin'\)/)
  assert.match(migrationSource, /public\.can_use_plan_feature\(feedback_forms\.club_id, 'customDevelopmentFields'\)/)
  assert.match(migrationSource, /team\.id = feedback_forms\.team_id/)
  assert.match(migrationSource, /team\.club_id = feedback_forms\.club_id/)
  assert.match(migrationSource, /feedback_form_snapshot jsonb not null default '\{\}'::jsonb/)
  assert.doesNotMatch(migrationSource, /delete from public\.evaluations|update public\.evaluations/i)
})
