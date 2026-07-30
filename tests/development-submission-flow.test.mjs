import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildDevelopmentCompletionItems,
  buildDevelopmentSubmissionReviewItems,
  createDevelopmentMeaningfulStateSignature,
  getDevelopmentSubmissionActionLabel,
} from '../src/lib/development-submission-flow.js'
import {
  hasPrivateEvaluationDraftContent,
} from '../src/lib/evaluation-drafts.js'
import {
  assertDevelopmentSubmissionOperation,
  normalizeDevelopmentSubmissionConfirmation,
} from '../netlify/functions/lib/_development-submission-operation.js'

const ids = {
  actor: '22222222-2222-4222-8222-222222222222',
  club: '11111111-1111-4111-8111-111111111111',
  evaluation: '55555555-5555-4555-8555-555555555555',
  link: '77777777-7777-4777-8777-777777777777',
  player: '44444444-4444-4444-8444-444444444444',
  team: '33333333-3333-4333-8333-333333333333',
}

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

function signature(overrides = {}) {
  return createDevelopmentMeaningfulStateSignature({
    formData: {},
    responseValues: {},
    previewMode: 'scored',
    nextAssessmentReminderChoice: 'skip',
    ...overrides,
  })
}

test('blank, player selection, form loading and previous prompt dismissal do not change meaningful state', () => {
  const blank = signature()
  const contextOnly = signature({
    formData: {
      playerId: ids.player,
      playerName: 'Synthetic Player',
      team: 'Synthetic Team',
      teamId: ids.team,
      coachName: 'Coach Fixture',
    },
    selectedFeedbackFormId: 'loaded-form',
    previousPromptDismissed: true,
  })

  assert.equal(contextOnly, blank)
  assert.equal(hasPrivateEvaluationDraftContent({
    formData: {
      playerName: 'Synthetic Player',
    },
  }), false)
})

test('responses, narrative, review dates and persisted output choices change meaningful state', () => {
  const blank = signature()
  const cases = [
    signature({ responseValues: { technical: '7' } }),
    signature({ responseValues: { narrative: 'Sharper decisions under pressure' } }),
    signature({ formData: { reportDate: '2026-07-29' } }),
    signature({
      previewMode: 'email',
      emailTemplateKey: 'development',
      selectedDevelopmentParentLinkIds: [ids.link],
    }),
    signature({
      previewMode: 'email',
      isPdfAttachmentApproved: true,
    }),
    signature({
      nextAssessmentReminderChoice: 'set',
      nextAssessmentReminderDate: '2026-08-29',
    }),
  ]

  cases.forEach((value) => assert.notEqual(value, blank))
})

test('normalized meaningful state ignores ordering and whitespace noise', () => {
  const left = signature({
    responseValues: {
      technical: ' 7 ',
      narrative: '  Good work ',
    },
    previewMode: 'email',
    selectedDevelopmentParentLinkIds: [ids.link, ids.link],
    selectedExportLabels: ['Mentality', 'Technical'],
  })
  const right = signature({
    responseValues: {
      narrative: 'Good work',
      technical: '7',
    },
    previewMode: 'email',
    selectedDevelopmentParentLinkIds: [ids.link],
    selectedExportLabels: ['Technical', 'Mentality'],
  })

  assert.equal(left, right)
})

test('final action labels and review summary match the requested behaviour', () => {
  assert.equal(
    getDevelopmentSubmissionActionLabel({ previewMode: 'scored' }),
    'Save record without email',
  )
  assert.equal(
    getDevelopmentSubmissionActionLabel({ previewMode: 'email', emailSendMode: 'now' }),
    'Save record and send email',
  )
  assert.equal(
    getDevelopmentSubmissionActionLabel({ previewMode: 'email', emailSendMode: 'scheduled' }),
    'Save record and schedule email',
  )

  const items = buildDevelopmentSubmissionReviewItems({
    playerName: 'Synthetic Player',
    teamName: 'Synthetic Team',
    recordDate: '29/07/2026',
    recipients: [{ name: 'Approved Internal' }],
    previewMode: 'email',
    emailSendMode: 'scheduled',
    isPdfAttachmentApproved: true,
    includeAttendanceSummary: true,
    selectedResponseCount: 9,
    nextAssessmentReminderChoice: 'set',
    nextAssessmentReminderDate: '2026-08-29',
  })

  assert.deepEqual(items, [
    'Player: Synthetic Player',
    'Team: Synthetic Team',
    'Record date: 29/07/2026',
    'Recipients: Approved Internal',
    'Parent email: Scheduled',
    'PDF: Attach',
    'Attendance: Included',
    'Selected responses: 9',
    'Reminder: 2026-08-29',
  ])
})

test('completion statuses distinguish saved, PDF, email and reminder outcomes', () => {
  assert.deepEqual(
    buildDevelopmentCompletionItems({
      emailOutcome: 'scheduled',
      isPdfAttachmentApproved: true,
      previewMode: 'email',
      reminderCreated: true,
      reminderDate: '2026-08-29',
    }),
    [
      'Development record: Saved',
      'PDF: Attached',
      'Parent email: Scheduled',
      'Reminder: Created for 2026-08-29',
    ],
  )
  assert.deepEqual(
    buildDevelopmentCompletionItems({
      emailOutcome: 'send_failed',
      isPdfAttachmentApproved: true,
      previewMode: 'email',
    }),
    [
      'Development record: Saved',
      'PDF: Failed, retry available',
      'Parent email: Not sent because requested PDF failed',
      'Reminder: Not requested',
    ],
  )
  assert.deepEqual(
    buildDevelopmentCompletionItems({
      emailOutcome: 'recipient_review',
      isPdfAttachmentApproved: true,
      previewMode: 'email',
    }),
    [
      'Development record: Saved',
      'PDF: Not generated, retry available',
      'Parent email: Not sent, review recipients',
      'Reminder: Not requested',
    ],
  )
})

test('server confirmation rejects missing operations and accepts an exact confirmed operation', async () => {
  const profile = {
    id: ids.actor,
    clubId: ids.club,
  }
  const body = {
    operationId: ids.evaluation,
    submissionOperationId: ids.evaluation,
    evaluationId: ids.evaluation,
    teamId: ids.team,
    playerId: ids.player,
    sendMode: 'scheduled',
    scheduledAt: '2026-08-01T12:00:00.000Z',
    attachPdf: true,
    includeAttendance: true,
    selectedParentLinkIds: [ids.link],
    selectedResponseCount: 9,
    reminderDate: '2026-08-29',
  }
  const confirmation = normalizeDevelopmentSubmissionConfirmation(body, profile)
  const operationRow = {
    operation_id: ids.evaluation,
    evaluation_id: ids.evaluation,
    club_id: ids.club,
    team_id: ids.team,
    player_id: ids.player,
    actor_id: ids.actor,
    send_mode: 'scheduled',
    scheduled_at: '2026-08-01T12:00:00+00:00',
    attach_pdf: true,
    include_attendance: true,
    selected_parent_link_ids: [ids.link],
    confirmation_hash: confirmation.confirmationHash,
    confirmed_at: '2026-07-29T12:00:00.000Z',
  }
  const supabaseAdmin = {
    from(table) {
      assert.equal(table, 'development_submission_operations')
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle: async () => ({
          data: operationRow,
          error: null,
        }),
      }
    },
  }

  await assert.rejects(
    assertDevelopmentSubmissionOperation(supabaseAdmin, {
      body: {
        ...body,
        submissionOperationId: '',
      },
      profile,
      outputContext: 'development_record',
    }),
    (error) => error.code === 'DEVELOPMENT_SUBMISSION_FINAL_CONFIRMATION_REQUIRED',
  )
  const result = await assertDevelopmentSubmissionOperation(supabaseAdmin, {
    body,
    profile,
    outputContext: 'development_record',
  })
  assert.equal(result.operation_id, ids.evaluation)
})

test('source sequencing and append-only database contracts preserve the final confirmation gate', async () => {
  const [page, handler, migration, submitSection] = await Promise.all([
    source('../src/pages/CreateEvaluationPage.jsx'),
    source('../netlify/functions/send-parent-email.js'),
    source('../supabase/migrations/20260729220000_development_submission_confirmation.sql'),
    source('../src/components/evaluations/SubmitExportSection.jsx'),
  ])
  const execution = page.slice(
    page.indexOf('const executeDevelopmentSubmission = async'),
    page.indexOf('const handleContinueWithDefaultTemplate'),
  )

  assert.ok(execution.indexOf('await createEvaluation') < execution.indexOf('await finalizeDevelopmentParentReport'))
  assert.ok(execution.indexOf('await finalizeDevelopmentParentReport') < execution.indexOf('await confirmDevelopmentSubmission'))
  assert.ok(execution.indexOf('await confirmDevelopmentSubmission') < execution.indexOf('sendParentEmail'))
  assert.ok(execution.indexOf('sendParentEmail') < execution.indexOf('createAssessmentReminderOnce'))
  assert.match(page, /Nothing has been saved, queued, generated, or sent yet\./)
  assert.match(page, /Use template and review submission/)
  assert.doesNotMatch(page, /Not now, send email/)
  assert.doesNotMatch(submitSection, /Submit Development Record/)
  assert.match(handler, /assertDevelopmentSubmissionOperation/)
  assert.match(handler, /ensureDevelopmentCommunicationLog/)
  assert.match(migration, /create table if not exists public\.development_submission_operations/)
  assert.match(migration, /communication_logs_next_assessment_reminder_once_idx/)
  assert.match(migration, /communication_logs_development_output_once_idx/)
  assert.doesNotMatch(migration, /drop table|drop column|delete from|truncate/i)
})
