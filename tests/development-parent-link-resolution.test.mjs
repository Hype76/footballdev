import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  applyDevelopmentParentContactResolution,
  resolveDevelopmentParentContact,
} from '../src/lib/development-parent-contact-resolution.js'
import {
  getDevelopmentParentRecipientCandidates,
  resolveSelectedDevelopmentParentRecipients,
} from '../src/lib/development-parent-recipient-contract.js'
import {
  resolveDevelopmentRecipientsFromRows,
} from '../netlify/functions/lib/_development-parent-email-output.js'

const clubId = '11111111-1111-4111-8111-111111111111'
const otherClubId = '22222222-2222-4222-8222-222222222222'
const teamId = '33333333-3333-4333-8333-333333333333'
const playerId = '44444444-4444-4444-8444-444444444444'
const evaluationId = '55555555-5555-4555-8555-555555555555'
const linkId = '66666666-6666-4666-8666-666666666666'
const authUserId = '77777777-7777-4777-8777-777777777777'
const guardianId = '88888888-8888-4888-8888-888888888888'

function link(overrides = {}) {
  return {
    id: linkId,
    club_id: clubId,
    team_id: teamId,
    player_id: playerId,
    guardian_id: null,
    auth_user_id: authUserId,
    email: 'linked.snapshot@example.test',
    relationship: 'Parent',
    primary_contact: true,
    receives_communications: false,
    status: 'active',
    accepted_at: '2026-07-01T10:00:00.000Z',
    ...overrides,
  }
}

function scope(overrides = {}) {
  return {
    clubId,
    teamId,
    playerId,
    parentContacts: [
      { name: 'FP TEST Parent', email: 'current.parent@example.test' },
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

test('email stored on the linked parent profile resolves without trusting the browser', () => {
  const resolved = resolveDevelopmentParentContact({
    link: link(),
    parentProfile: {
      id: authUserId,
      email: 'current.parent@example.test',
      display_name: 'FP TEST Parent',
    },
  })

  assert.equal(resolved.source, 'parent_profile')
  assert.equal(resolved.email, 'current.parent@example.test')
  assert.equal(resolved.eligible, true)
})

test('email stored on the canonical guardian contact record resolves', () => {
  const resolved = resolveDevelopmentParentContact({
    link: link({
      guardian_id: guardianId,
      auth_user_id: null,
      email: '',
      receives_communications: true,
    }),
    guardian: {
      id: guardianId,
      club_id: clubId,
      first_name: 'FP TEST',
      last_name: 'Guardian',
      email: 'guardian.current@example.test',
      status: 'active',
    },
  })

  assert.equal(resolved.source, 'guardian')
  assert.equal(resolved.email, 'guardian.current@example.test')
  assert.equal(resolved.eligible, true)
})

test('current Auth email is authoritative for an accepted portal link', () => {
  const resolved = resolveDevelopmentParentContact({
    link: link(),
    authUser: {
      id: authUserId,
      email: 'auth.current@example.test',
      user_metadata: { display_name: 'FP TEST Parent' },
    },
  })

  assert.equal(resolved.source, 'auth_user')
  assert.equal(resolved.email, 'auth.current@example.test')
})

test('legacy player-level link with null team remains compatible', () => {
  const enriched = applyDevelopmentParentContactResolution({
    link: link({ team_id: null }),
    authUser: {
      id: authUserId,
      email: 'current.parent@example.test',
    },
  })
  const candidates = getDevelopmentParentRecipientCandidates({
    links: [enriched],
    ...scope(),
  })

  assert.equal(candidates[0].eligible, true)
})

test('legacy portal link default false is treated as unspecified, not an explicit opt-out', () => {
  const enriched = applyDevelopmentParentContactResolution({
    link: link({ guardian_id: null, receives_communications: false }),
    authUser: {
      id: authUserId,
      email: 'current.parent@example.test',
    },
  })
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [enriched],
    ...scope(),
    selectedParentLinkIds: [linkId],
  })

  assert.equal(result.outcome, 'ready')
  assert.equal(result.recipients[0].communicationsPreferenceExplicit, false)
})

test('two accepted Auth-linked parents remain eligible without duplicated player contacts', () => {
  const secondLinkId = '99999999-9999-4999-8999-999999999999'
  const links = [
    applyDevelopmentParentContactResolution({
      link: link(),
      authUser: {
        id: authUserId,
        email: 'first.current@example.test',
      },
    }),
    applyDevelopmentParentContactResolution({
      link: link({
        id: secondLinkId,
        auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'second.snapshot@example.test',
        primary_contact: false,
      }),
      authUser: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'second.current@example.test',
      },
    }),
  ]
  const result = resolveSelectedDevelopmentParentRecipients({
    links,
    ...scope({ parentContacts: [] }),
    selectedParentLinkIds: [linkId, secondLinkId],
  })

  assert.equal(result.outcome, 'ready')
  assert.deepEqual(result.recipients.map((recipient) => recipient.linkId), [
    linkId,
    secondLinkId,
  ])
  assert.deepEqual(result.deliveryRecipients.map((recipient) => recipient.email), [
    'first.current@example.test',
    'second.current@example.test',
  ])
})

test('nullable legacy communication preference is accepted safely', () => {
  const enriched = applyDevelopmentParentContactResolution({
    link: link({ receives_communications: null }),
    authUser: {
      id: authUserId,
      email: 'current.parent@example.test',
    },
  })
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [enriched],
    ...scope(),
    selectedParentLinkIds: [linkId],
  })

  assert.equal(result.outcome, 'ready')
})

test('explicit communication-disabled guardian link is denied', () => {
  const enriched = applyDevelopmentParentContactResolution({
    link: link({
      guardian_id: guardianId,
      auth_user_id: null,
      receives_communications: false,
    }),
    guardian: {
      id: guardianId,
      club_id: clubId,
      email: 'guardian.current@example.test',
      status: 'active',
    },
  })
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [enriched],
    ...scope(),
    selectedParentLinkIds: [linkId],
  })

  assert.equal(result.outcome, 'no_recipient')
})

test('inactive and revoked links are denied', () => {
  for (const status of ['pending', 'uninvited', 'revoked']) {
    const result = resolveSelectedDevelopmentParentRecipients({
      links: [link({ status, receives_communications: true })],
      ...scope(),
      selectedParentLinkIds: [linkId],
    })

    assert.equal(result.outcome, 'no_recipient')
  }
})

test('cross-club and wrong-player links are denied', () => {
  for (const changedLink of [
    link({ club_id: otherClubId, receives_communications: true }),
    link({
      player_id: '99999999-9999-4999-8999-999999999999',
      receives_communications: true,
    }),
  ]) {
    const result = resolveSelectedDevelopmentParentRecipients({
      links: [changedLink],
      ...scope(),
      selectedParentLinkIds: [linkId],
    })

    assert.equal(result.outcome, 'no_recipient')
  }
})

test('parent profile, Auth user, guardian and link identifiers remain distinct', () => {
  const unrelatedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const result = resolveSelectedDevelopmentParentRecipients({
    links: [link({ guardian_id: guardianId, receives_communications: true })],
    ...scope(),
    selectedParentLinkIds: [unrelatedId],
  })

  assert.equal(result.outcome, 'no_recipient')
})

test('UI and server return the same eligible parent-link ID', () => {
  const enriched = applyDevelopmentParentContactResolution({
    link: link(),
    authUser: {
      id: authUserId,
      email: 'current.parent@example.test',
    },
  })
  const uiRecipients = getDevelopmentParentRecipientCandidates({
    links: [enriched],
    ...scope(),
  }).filter((candidate) => candidate.eligible)
  const serverResult = resolveDevelopmentRecipientsFromRows({
    evaluation: evaluation(),
    player: player(),
    links: [enriched],
    selectedParentLinkIds: [linkId],
  })

  assert.equal(serverResult.outcome, 'ready')
  assert.deepEqual(
    serverResult.recipients.map((recipient) => recipient.linkId),
    uiRecipients.map((recipient) => recipient.linkId),
  )
})

test('recipient discovery and send both use the server resolver', async () => {
  const clientSource = await source('../src/lib/domain/development-parent-email-recipients.js')
  const functionSource = await source('../netlify/functions/send-parent-email.js')
  const helperSource = await source('../netlify/functions/lib/_development-parent-email-output.js')

  assert.match(clientSource, /action: 'resolve_development_recipients'/)
  assert.doesNotMatch(clientSource, /\.from\('parent_player_links'\)/)
  assert.match(functionSource, /loadDevelopmentParentRecipientCandidates/)
  assert.match(functionSource, /loadDevelopmentParentEmailContext/)
  assert.match(helperSource, /getUserById\(authUserId\)/)
  assert.match(helperSource, /team_id\.is\.null/)
})

test('previously saved record resend uses stable link IDs without creating another record', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const formUtilsSource = await source('../src/hooks/evaluations/evaluationFormUtils.js')

  assert.match(pageSource, /const canReusePersistedEvaluation/)
  assert.match(pageSource, /persistedEvaluationForRetryRef/)
  assert.match(formUtilsSource, /selectedParentLinkIds: usesServerRecipientResolution && contact\?\.linkId/)
  assert.match(formUtilsSource, /parentEmail: usesServerRecipientResolution \? '' : recipientEmail/)
})

test('failed output refresh preserves only currently eligible recipients and retains duplicate protection', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const functionSource = await source('../netlify/functions/send-parent-email.js')

  assert.match(pageSource, /loadDevelopmentParentRecipients\(\{\s*preserveSelected: true/)
  assert.match(pageSource, /current\.filter\(\(linkId\) => eligibleIds\.has\(linkId\)\)/)
  assert.doesNotMatch(pageSource, /preservedSelected|no_longer_available/)
  assert.match(functionSource, /storedPayload\.outputKey/)
  assert.match(functionSource, /const finalIdempotencyKey = preparedEmail\.storedPayload\.outputKey/)
})

test('Manual Save Draft and final evaluation submission remain unchanged', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const draftStart = pageSource.indexOf('const handleSaveDraft = async () =>')
  const draftEnd = pageSource.indexOf('const handleDiscardPrivateDraft = async () =>', draftStart)
  const draftSource = pageSource.slice(draftStart, draftEnd)

  assert.match(draftSource, /saveServerEvaluationDraft/)
  assert.doesNotMatch(draftSource, /sendParentEmail|selectedParentLinkIds/)
  assert.match(pageSource, /let completionOutcome = 'saved'/)
  assert.match(pageSource, /const savedEvaluation = canReusePersistedEvaluation/)
})
