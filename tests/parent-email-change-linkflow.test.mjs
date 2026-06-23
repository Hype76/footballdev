import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  classifyParentEmailChange,
  getSafeEmailChangeErrorMessage,
} from '../netlify/functions/_parent-email-change-rules.js'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const emailChangeFunctionUrl = new URL('../netlify/functions/parent-portal-email-change.js', import.meta.url)
const emailChangeRulesUrl = new URL('../netlify/functions/_parent-email-change-rules.js', import.meta.url)

const currentParent = { id: 'current-parent-auth', email: 'current@example.com' }
const targetParent = { id: 'target-parent-auth', email: 'shared@example.com' }
const currentClydeLink = {
  id: 'clyde-link',
  clubId: 'club-1',
  teamId: 'team-1',
  playerId: 'clyde',
  linkType: 'parent',
  email: 'current@example.com',
  authUserId: currentParent.id,
  status: 'active',
  contactEmails: ['shared@example.com'],
}
const targetSiblingLink = {
  id: 'sibling-link',
  clubId: 'club-1',
  teamId: 'team-1',
  playerId: 'sibling',
  linkType: 'parent',
  email: 'shared@example.com',
  authUserId: targetParent.id,
  status: 'active',
  contactEmails: ['shared@example.com'],
}

test('parent email link-flow no-ops for the current Auth email', () => {
  const decision = classifyParentEmailChange({
    authUser: currentParent,
    requestedEmail: 'current@example.com',
    currentLinks: [currentClydeLink],
  })

  assert.equal(decision.ok, true)
  assert.equal(decision.action, 'noop')
  assert.equal(decision.message, 'Email already up to date.')
})

test('parent email link-flow normalizes mixed-case and whitespace current emails before no-op', () => {
  const decision = classifyParentEmailChange({
    authUser: { id: currentParent.id, email: 'Current@Example.com' },
    requestedEmail: '  CURRENT@example.COM  ',
    currentLinks: [currentClydeLink],
  })

  assert.equal(decision.ok, true)
  assert.equal(decision.action, 'noop')
  assert.equal(decision.email, 'current@example.com')
  assert.equal(decision.message, 'Email already up to date.')
})

test('parent email link-flow requests Auth confirmation only for unregistered new emails', () => {
  const decision = classifyParentEmailChange({
    authUser: currentParent,
    requestedEmail: 'new-parent@example.com',
    currentLinks: [currentClydeLink],
    targetAuthUser: null,
    targetLinks: [],
  })

  assert.equal(decision.ok, true)
  assert.equal(decision.action, 'request-auth-email-change')
})

test('parent email link-flow no-ops when same-family email already has a non-revoked child link', () => {
  const existingClydeTargetLink = {
    ...currentClydeLink,
    id: 'existing-clyde-target-link',
    email: 'shared@example.com',
    authUserId: '',
    status: 'pending',
  }
  const decision = classifyParentEmailChange({
    authUser: currentParent,
    requestedEmail: 'shared@example.com',
    currentLinks: [currentClydeLink],
    targetAuthUser: null,
    targetLinks: [existingClydeTargetLink],
  })

  assert.equal(decision.ok, true)
  assert.equal(decision.action, 'existing-parent-already-linked')
  assert.deepEqual(decision.transferLinkIds, [])
})

test('parent email link-flow repeated same-family submissions stay idempotent', () => {
  const existingClydeTargetLink = {
    ...currentClydeLink,
    id: 'existing-clyde-target-link',
    email: 'shared@example.com',
    authUserId: targetParent.id,
    status: 'active',
  }
  const firstDecision = classifyParentEmailChange({
    authUser: currentParent,
    requestedEmail: 'shared@example.com',
    currentLinks: [currentClydeLink],
    targetAuthUser: targetParent,
    targetLinks: [existingClydeTargetLink],
  })
  const secondDecision = classifyParentEmailChange({
    authUser: currentParent,
    requestedEmail: ' shared@example.com ',
    currentLinks: [currentClydeLink],
    targetAuthUser: targetParent,
    targetLinks: [existingClydeTargetLink],
  })

  assert.equal(firstDecision.action, 'existing-parent-already-linked')
  assert.equal(secondDecision.action, 'existing-parent-already-linked')
  assert.deepEqual(firstDecision.transferLinkIds, [])
  assert.deepEqual(secondDecision.transferLinkIds, [])
})

test('parent email link-flow links an existing same-family parent account without Auth update', () => {
  const decision = classifyParentEmailChange({
    authUser: currentParent,
    requestedEmail: 'shared@example.com',
    currentLinks: [currentClydeLink],
    targetAuthUser: targetParent,
    targetLinks: [targetSiblingLink],
  })

  assert.equal(decision.ok, true)
  assert.equal(decision.action, 'link-existing-parent')
  assert.deepEqual(decision.transferLinkIds, ['clyde-link'])
})

test('parent email link-flow rejects unrelated existing parent accounts', () => {
  const decision = classifyParentEmailChange({
    authUser: currentParent,
    requestedEmail: 'other@example.com',
    currentLinks: [{ ...currentClydeLink, contactEmails: ['current@example.com'] }],
    targetAuthUser: { id: 'other-parent-auth', email: 'other@example.com' },
    targetLinks: [{ ...targetSiblingLink, clubId: 'club-2', email: 'other@example.com', authUserId: 'other-parent-auth' }],
  })

  assert.equal(decision.ok, false)
  assert.equal(decision.statusCode, 409)
  assert.equal(decision.message, 'That email is already used by another parent account. Please ask the club to confirm the correct family link.')
})

test('parent email link-flow masks PostgreSQL 23505 unique constraint errors', () => {
  const message = getSafeEmailChangeErrorMessage({
    code: '23505',
    message: 'duplicate key value violates unique constraint "parent_player_links_unique_email"',
    details: "Key (team_id, player_id, lower(coalesce(email, ''::text)), link_type) already exists.",
  })

  assert.equal(message, 'Email could not be updated. Please try again in a moment.')
  assert.doesNotMatch(message, /23505|duplicate key|parent_player_links_unique_email|violates unique constraint/i)
})

test('parent settings only calls Supabase Auth update after helper approves a new email', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const handlerStart = source.indexOf('const handleEmailSubmit = async (event) => {')
  const handlerEnd = source.indexOf('const handlePasswordSubmit = async (event) => {', handlerStart)
  const handlerSection = source.slice(handlerStart, handlerEnd)
  const noOpStart = handlerSection.indexOf('if (currentEmails.has(normalizedEmail))')
  const prepareStart = handlerSection.indexOf('const emailChangeIntent = await prepareParentPortalEmailChange')
  const requestStart = handlerSection.indexOf('await requestLoginEmailChange')

  assert.notEqual(noOpStart, -1)
  assert.notEqual(prepareStart, -1)
  assert.notEqual(requestStart, -1)
  assert.ok(noOpStart < prepareStart)
  assert.ok(prepareStart < requestStart)
  assert.match(handlerSection, /emailChangeIntent\.action === 'request-auth-email-change'/)
  assert.doesNotMatch(handlerSection.slice(noOpStart, prepareStart), /requestLoginEmailChange/)
  assert.doesNotMatch(handlerSection.slice(prepareStart, requestStart), /requestLoginEmailChange/)
})

test('parent email helper uses the signed-in session and masks raw duplicate Auth errors', async () => {
  const [domainSource, functionSource, rulesSource, pageSource] = await Promise.all([
    readFile(parentPortalDomainUrl, 'utf8'),
    readFile(emailChangeFunctionUrl, 'utf8'),
    readFile(emailChangeRulesUrl, 'utf8'),
    readFile(parentPortalPageUrl, 'utf8'),
  ])

  assert.match(domainSource, /prepareParentPortalEmailChange/)
  assert.match(domainSource, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.match(functionSource, /findAuthUserByEmail/)
  assert.match(functionSource, /\.neq\('status', 'revoked'\)/)
  assert.match(functionSource, /isParentEmailUniqueConflict/)
  assert.match(functionSource, /getSafeEmailChangeErrorMessage/)
  assert.match(functionSource, /transferParentLinks/)
  assert.match(functionSource, /classifyParentEmailChange/)
  assert.match(rulesSource, /link-existing-parent/)
  assert.match(rulesSource, /hasSameUniqueEmailLink/)
  assert.match(pageSource, /parentPortalUnsafeEmailMessage/)
  assert.match(pageSource, /parent_player_links_unique_email/)
  assert.doesNotMatch(pageSource, /A user with this email address has already been registered/)
  assert.doesNotMatch(pageSource, /Error sending email change email/)
})
