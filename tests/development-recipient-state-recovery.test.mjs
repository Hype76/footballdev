import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getDevelopmentParentRecipientCandidates,
  resolveSelectedDevelopmentParentRecipients,
} from '../src/lib/development-parent-recipient-contract.js'
import {
  createDevelopmentOutputKey,
  createDevelopmentOutputQueueId,
  resolveDevelopmentRecipientsFromRows,
} from '../netlify/functions/lib/_development-parent-email-output.js'

const clubId = '11111111-1111-4111-8111-111111111111'
const otherClubId = '22222222-2222-4222-8222-222222222222'
const teamId = '33333333-3333-4333-8333-333333333333'
const playerId = '44444444-4444-4444-8444-444444444444'
const evaluationId = '55555555-5555-4555-8555-555555555555'
const firstLinkId = '66666666-6666-4666-8666-666666666666'
const secondLinkId = '77777777-7777-4777-8777-777777777777'

function link(overrides = {}) {
  return {
    id: firstLinkId,
    club_id: clubId,
    team_id: teamId,
    player_id: playerId,
    email: 'first.parent@example.test',
    relationship: 'Parent',
    primary_contact: true,
    receives_communications: true,
    status: 'active',
    ...overrides,
  }
}

function scope(overrides = {}) {
  return {
    clubId,
    teamId,
    playerId,
    parentContacts: [
      { name: 'FP TEST One', email: 'first.parent@example.test' },
      { name: 'FP TEST Two', email: 'second.parent@example.test' },
    ],
    ...overrides,
  }
}

function evaluation(overrides = {}) {
  return {
    id: evaluationId,
    club_id: clubId,
    team_id: teamId,
    player_id: playerId,
    ...overrides,
  }
}

function player(overrides = {}) {
  return {
    id: playerId,
    club_id: clubId,
    team_id: teamId,
    parent_contacts: scope().parentContacts,
    ...overrides,
  }
}

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('UI and server eligibility use the same parent-link fixture', () => {
  const links = [link()]
  const uiRecipients = getDevelopmentParentRecipientCandidates({
    links,
    ...scope(),
  }).filter((candidate) => candidate.eligible)
  const serverRecipients = resolveDevelopmentRecipientsFromRows({
    evaluation: evaluation(),
    player: player(),
    links,
    selectedParentLinkIds: [firstLinkId],
  })

  assert.equal(serverRecipients.outcome, 'ready')
  assert.deepEqual(serverRecipients.recipients, uiRecipients)
})

test('two eligible selected parents resolve as two server recipients', () => {
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [
      link(),
      link({
        id: secondLinkId,
        email: 'second.parent@example.test',
        primary_contact: false,
      }),
    ],
    ...scope(),
    selectedParentLinkIds: [firstLinkId, secondLinkId],
  })

  assert.equal(result.outcome, 'ready')
  assert.deepEqual(result.recipients.map((recipient) => recipient.linkId), [
    firstLinkId,
    secondLinkId,
  ])
})

test('previously saved evaluation resend passes stable selected link IDs', async () => {
  const formUtilsSource = await source('../src/hooks/evaluations/evaluationFormUtils.js')
  const emailBuilderSource = await source('../src/lib/email-builder.js')

  assert.match(formUtilsSource, /selectedParentLinkIds: usesServerRecipientResolution && contact\?\.linkId/)
  assert.match(formUtilsSource, /parentEmail: usesServerRecipientResolution \? '' : recipientEmail/)
  assert.match(emailBuilderSource, /selectedParentLinkIds: data\.selectedParentLinkIds/)
})

test('link ID is not confused with a user, profile, guardian or parent ID', () => {
  const unrelatedId = '88888888-8888-4888-8888-888888888888'
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [link({ guardian_id: unrelatedId, auth_user_id: unrelatedId })],
    ...scope(),
    selectedParentLinkIds: [unrelatedId],
  })

  assert.equal(result.outcome, 'no_recipient')
  assert.equal(result.code, 'DEVELOPMENT_PARENT_EMAIL_SELECTED_LINK_UNAVAILABLE')
})

test('same-club, same-team and same-player links succeed', () => {
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [link()],
    ...scope(),
    selectedParentLinkIds: [firstLinkId],
  })

  assert.equal(result.outcome, 'ready')
})

test('cross-club links fail', () => {
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [link({ club_id: otherClubId })],
    ...scope(),
    selectedParentLinkIds: [firstLinkId],
  })

  assert.equal(result.outcome, 'no_recipient')
})

test('inactive links fail', () => {
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [link({ status: 'revoked' })],
    ...scope(),
    selectedParentLinkIds: [firstLinkId],
  })

  assert.equal(result.outcome, 'no_recipient')
})

test('communication-disabled links fail', () => {
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [
      link({
        guardian_id: '99999999-9999-4999-8999-999999999999',
        receives_communications: false,
      }),
    ],
    ...scope(),
    selectedParentLinkIds: [firstLinkId],
  })

  assert.equal(result.outcome, 'no_recipient')
})

test('valid links with valid emails succeed', () => {
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [link()],
    ...scope(),
    selectedParentLinkIds: [firstLinkId],
  })

  assert.equal(result.recipients[0].email, 'first.parent@example.test')
})

test('failed send retains available recipients', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.match(pageSource, /loadDevelopmentParentRecipients\(\{\s*preserveSelected: true/)
  assert.match(pageSource, /const preservedSelected = current/)
})

test('failed send retains selected recipients', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.match(pageSource, /selectedDevelopmentParentLinkIdsRef\.current/)
  assert.doesNotMatch(
    pageSource.slice(
      pageSource.indexOf('const handleSubmit = async'),
      pageSource.indexOf('const handleContinueWithDefaultTemplate'),
    ),
    /setSelectedDevelopmentParentLinkIds\(\[\]\)/,
  )
})

test('failed send does not replace recipients with empty fallback inputs', async () => {
  const componentSource = await source('../src/components/evaluations/EvaluationPlayerDetailsSection.jsx')

  assert.match(componentSource, /useLinkedParentRecipients \? \(/)
  assert.match(componentSource, /No eligible linked parent email is currently available\./)
})

test('retry uses the same selected recipients', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.match(pageSource, /persistedEvaluationForRetryRef/)
  assert.match(pageSource, /selectedDevelopmentParentLinkIds\.includes\(contact\.linkId\)/)
  assert.match(pageSource, /!shouldPreserveSavedRecordForRetry && !editingEvaluation/)
})

test('retry does not duplicate the evaluation', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.match(pageSource, /const canReusePersistedEvaluation/)
  assert.match(pageSource, /canReusePersistedEvaluation\s*\?\s*priorPersistedEvaluation\.evaluation/)
})

test('retry does not duplicate queue or provider actions', async () => {
  const firstKey = createDevelopmentOutputKey(evaluationId, firstLinkId)
  const secondKey = createDevelopmentOutputKey(evaluationId, secondLinkId)
  const functionSource = await source('../netlify/functions/send-parent-email.js')

  assert.notEqual(firstKey, secondKey)
  assert.match(createDevelopmentOutputQueueId(firstKey), /^[0-9a-f-]{36}$/)
  assert.match(functionSource, /storedPayload\.outputQueueId/)
  assert.match(functionSource, /const finalIdempotencyKey = preparedEmail\.storedPayload\.outputKey/)
})

test('no-recipient result is shown only when the refreshed authoritative query has zero eligible links', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.match(
    pageSource,
    /refreshedRecipients\.some\(\(recipient\) => recipient\.eligible\)[\s\S]*'no_recipient'/,
  )
})

test('parent-visible fields only remain server-authoritative', async () => {
  const helperSource = await source('../netlify/functions/lib/_development-parent-email-output.js')

  assert.match(helperSource, /getParentVisibleDevelopmentResponses/)
  assert.match(helperSource, /getParentVisibleDevelopmentEmailSections/)
})

test('parent and player delivery preserves player-self contacts beside linked parents', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.match(pageSource, /const savedSelfContacts = useMemo/)
  assert.match(pageSource, /normalizedContactType === PLAYER_CONTACT_TYPES\.both \? savedSelfContacts/)
  assert.match(pageSource, /contact\.legacyIndex/)
})

test('Manual Save Draft remains unchanged', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const start = pageSource.indexOf('const handleSaveDraft = async () =>')
  const end = pageSource.indexOf('const handleDiscardPrivateDraft = async () =>', start)
  const draftSource = pageSource.slice(start, end)

  assert.match(draftSource, /saveServerEvaluationDraft/)
  assert.doesNotMatch(draftSource, /sendParentEmail|createEvaluation|selectedParentLinkIds/)
})

test('previously saved Development Record remains unchanged after send failure', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.match(pageSource, /const shouldPreserveSavedRecordForRetry/)
  assert.match(pageSource, /if \(!shouldPreserveSavedRecordForRetry && !editingEvaluation/)
  assert.match(pageSource, /const existingEvaluationId = String/)
})
