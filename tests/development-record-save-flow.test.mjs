import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  EMAIL_TEMPLATE_AUDIENCES,
} from '../src/lib/email-templates.js'
import {
  createEvaluationPayload,
  getDevelopmentRecordSaveFailureMessage,
  normalizeOptionalUuid,
  buildParentEmailJobs,
} from '../src/hooks/evaluations/evaluationFormUtils.js'
import { mapEvaluationToRow } from '../src/lib/domain/evaluation-normalizers.js'
import { PLAYER_CONTACT_TYPES } from '../src/lib/domain/contact-utils.js'

const clubId = '11111111-1111-4111-8111-111111111111'
const teamId = '22222222-2222-4222-8222-222222222222'
const playerId = '33333333-3333-4333-8333-333333333333'
const coachId = '44444444-4444-4444-8444-444444444444'
const evaluationId = '55555555-5555-4555-8555-555555555555'
const assessmentSessionId = '66666666-6666-4666-8666-666666666666'
const feedbackFormId = '77777777-7777-4777-8777-777777777777'

function createBasePayload(overrides = {}) {
  return createEvaluationPayload({
    assessmentSessionId: overrides.assessmentSessionId ?? '',
    availableTeams: [{ id: teamId, name: 'Demo Team' }],
    averageScore: 7,
    comments: {
      strengths: 'Good first touch.',
      improvements: '',
      overall: 'Positive session.',
      selectedStrengths: [],
    },
    editingEvaluation: null,
    formData: {
      coachName: 'Coach One',
      contactType: 'parent',
      parentContacts: [
        {
          email: 'parent@example.com',
          name: 'Parent One',
          type: 'parent',
        },
      ],
      parentEmail: 'parent@example.com',
      parentName: 'Parent One',
      playerName: 'Clyde Bates',
      section: 'Squad',
      session: overrides.session ?? '2026-06-18',
      team: 'Demo Team',
    },
    formResponses: {
      Technical: 7,
      'Overall Comments': 'Positive session.',
    },
    id: overrides.id ?? evaluationId,
    normalizedContactType: 'parent',
    parentContacts: [
      {
        email: 'parent@example.com',
        name: 'Parent One',
        type: 'parent',
      },
    ],
    savedPlayers: [
      {
        id: playerId,
        parentContacts: [
          {
            email: 'parent@example.com',
            name: 'Parent One',
            type: 'parent',
          },
        ],
        playerName: 'Clyde Bates',
        section: 'Squad',
        team: 'Demo Team',
        teamId,
      },
    ],
    scores: {
      Technical: 7,
    },
    user: {
      id: coachId,
      activeTeamId: teamId,
      clubId,
      email: 'coach@example.com',
      name: 'Coach One',
      username: 'Coach One',
    },
  })
}

test('optional UUID normalizer removes route placeholders before final save', () => {
  assert.equal(normalizeOptionalUuid(''), '')
  assert.equal(normalizeOptionalUuid('null'), '')
  assert.equal(normalizeOptionalUuid('undefined'), '')
  assert.equal(normalizeOptionalUuid('not-a-session'), '')
  assert.equal(normalizeOptionalUuid(assessmentSessionId), assessmentSessionId)
})

test('final development record payload omits invalid unscheduled session ids', () => {
  const payload = createBasePayload({ assessmentSessionId: 'null' })
  const row = mapEvaluationToRow(payload)

  assert.equal(payload.assessmentSessionId, '')
  assert.equal(row.assessment_session_id, null)
  assert.equal(row.player_id, playerId)
  assert.equal(row.team_id, teamId)
  assert.equal(row.club_id, clubId)
})

test('final development record payload keeps valid scheduled session ids', () => {
  const payload = createBasePayload({ assessmentSessionId })
  const row = mapEvaluationToRow(payload)

  assert.equal(payload.assessmentSessionId, assessmentSessionId)
  assert.equal(row.assessment_session_id, assessmentSessionId)
})

test('final development record payload keeps active team id when team name lookup misses', () => {
  const payload = createEvaluationPayload({
    assessmentSessionId: '',
    availableTeams: [{ id: '99999999-9999-4999-8999-999999999999', name: 'Other Team' }],
    averageScore: 7,
    comments: {
      strengths: 'Good first touch.',
      improvements: '',
      overall: 'Positive session.',
      selectedStrengths: [],
    },
    editingEvaluation: null,
    feedbackForm: {
      id: feedbackFormId,
      name: 'Match feedback',
      teamId,
      version: 1,
    },
    feedbackFormSnapshot: null,
    formData: {
      coachName: 'Coach One',
      contactType: 'parent',
      parentContacts: [],
      playerName: 'Clyde Bates',
      section: 'Squad',
      session: '2026-06-18',
      team: 'Demo Team',
    },
    formResponses: {
      Technical: 7,
    },
    id: evaluationId,
    normalizedContactType: 'parent',
    parentContacts: [],
    savedPlayers: [
      {
        id: playerId,
        playerName: 'Clyde Bates',
        section: 'Squad',
        team: 'Demo Team',
        teamId,
      },
    ],
    scores: {
      Technical: 7,
    },
    user: {
      activeTeamId: teamId,
      clubId,
      email: 'coach@example.com',
      id: coachId,
      name: 'Coach One',
      username: 'Coach One',
    },
  })
  const row = mapEvaluationToRow(payload)

  assert.equal(payload.teamId, teamId)
  assert.equal(payload.playerId, playerId)
  assert.equal(payload.feedbackFormId, feedbackFormId)
  assert.equal(row.team_id, teamId)
  assert.equal(row.feedback_form_id, feedbackFormId)
})

test('final development record payload requires a valid report date', () => {
  assert.throws(
    () => createBasePayload({ session: '' }),
    /Please enter a report date before saving\./,
  )
})

test('final development record row saves the report date from the session date field', () => {
  const payload = createBasePayload({ session: '2026-06-17' })
  const row = mapEvaluationToRow(payload)

  assert.equal(payload.date, '17/06/2026')
  assert.equal(row.date, '17/06/2026')
})

test('final development record payload does not send invalid fallback ids to uuid primary key', () => {
  const payload = createBasePayload({ id: '1700000000000-abc' })
  const row = mapEvaluationToRow(payload)

  assert.equal(payload.id, undefined)
  assert.equal(row.id, undefined)
})

test('email output can prepare a selected linked parent recipient without sending email', () => {
  const evaluation = createBasePayload()
  const jobs = buildParentEmailJobs({
    attachPdf: false,
    contactAudiences: [EMAIL_TEMPLATE_AUDIENCES.parent],
    emailSections: [],
    emailTemplates: [
      {
        audience: EMAIL_TEMPLATE_AUDIENCES.parent,
        body: 'Hi {{ parent_name }}, {{ player_name }} has a new update.',
        isEnabled: true,
        key: 'assessment',
        label: 'Assessment',
        subject: '{{ player_name }} development update',
      },
    ],
    evaluation,
    formData: {
      coachName: 'Coach One',
      parentName: 'Parent One',
      playerName: 'Clyde Bates',
      section: 'Squad',
      session: '',
      team: 'Demo Team',
    },
    inviteDate: '',
    normalizedPlayerName: 'Clyde Bates',
    playerContactTypes: PLAYER_CONTACT_TYPES,
    selectedEmailTemplateKey: 'assessment',
    selectedParentContacts: [
      {
        email: 'parent@example.com',
        name: 'Parent One',
        type: 'parent',
      },
    ],
    selectedResponseItems: [
      {
        label: 'Technical',
        value: 7,
      },
    ],
    user: {
      clubId,
      clubName: 'Demo Club',
      email: 'coach@example.com',
      id: coachId,
      name: 'Coach One',
    },
  })

  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].recipientEmail, 'parent@example.com')
  assert.equal(jobs[0].payload.evaluationId, evaluation.id)
  assert.equal(typeof jobs[0].job, 'function')
})

test('email output with no selected parent recipient produces no send jobs', () => {
  const jobs = buildParentEmailJobs({
    contactAudiences: [EMAIL_TEMPLATE_AUDIENCES.parent],
    emailTemplates: [],
    formData: {
      parentName: '',
      playerName: 'Clyde Bates',
      section: 'Squad',
      session: '',
      team: 'Demo Team',
    },
    normalizedPlayerName: 'Clyde Bates',
    playerContactTypes: PLAYER_CONTACT_TYPES,
    selectedParentContacts: [],
    selectedResponseItems: [],
    user: {
      clubId,
      id: coachId,
    },
  })

  assert.deepEqual(jobs, [])
})

test('save failure message gives safe diagnostics for final database failures', () => {
  assert.equal(
    getDevelopmentRecordSaveFailureMessage({ code: '22P02', message: 'invalid input syntax for type uuid: "null"' }),
    'The selected player or session link is no longer valid. Reopen the player from the squad list and save again.',
  )
  assert.equal(
    getDevelopmentRecordSaveFailureMessage({ code: '23503', message: 'foreign key constraint failed' }),
    'The selected player, team, or session could not be matched. Refresh the player details and try again.',
  )
  assert.equal(
    getDevelopmentRecordSaveFailureMessage({ code: '23505', message: 'duplicate key value violates unique constraint "evaluations_pkey"' }),
    'This development record was already saved. Refresh the player profile before trying again.',
  )
  assert.equal(
    getDevelopmentRecordSaveFailureMessage({ code: '42501', message: 'new row violates row-level security policy' }),
    'Your account does not have permission to save this development record for the selected player.',
  )
  assert.equal(
    getDevelopmentRecordSaveFailureMessage({ message: 'unknown failure' }),
    'This development record could not be saved right now. Check the player details and try again.',
  )
  assert.equal(
    getDevelopmentRecordSaveFailureMessage({ message: 'Please enter a report date before saving.' }),
    'Please enter a report date before saving.',
  )
})

test('final save retry recovers an existing draft-backed evaluation after duplicate id conflict', async () => {
  const source = await readFile(new URL('../src/lib/domain/evaluation-actions.js', import.meta.url), 'utf8')

  assert.match(source, /function isDuplicateEvaluationIdConflict\(error\)/)
  assert.match(source, /code === '23505'/)
  assert.match(source, /evaluations_pkey/)
  assert.match(source, /\.from\('evaluations'\)[\s\S]*\.eq\('id', payload\.id\)[\s\S]*\.maybeSingle\(\)/)
  assert.match(source, /isDuplicateEvaluationIdConflict\(error\)[\s\S]*recoverCreatedEvaluationFromDuplicateId\(payload\)/)
  assert.match(source, /return normalizeEvaluationRow\(existingRow\)/)
})
