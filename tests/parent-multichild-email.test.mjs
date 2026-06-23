import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentInvitePageUrl = new URL('../src/pages/ParentInvitePage.jsx', import.meta.url)
const createParentAccountFunctionUrl = new URL('../netlify/functions/create-parent-account.js', import.meta.url)
const cleanupMigrationUrl = new URL('../supabase/migrations/20260616070626_harden_parent_portal_cleanup.sql', import.meta.url)

const multichildFixture = {
  parentEmail: 'jason@example.com',
  authUserId: 'parent-auth-1',
  links: [
    {
      id: 'clyde-link',
      authUserId: 'parent-auth-1',
      email: 'jason@example.com',
      playerId: 'clyde',
      playerName: 'Clyde Bates',
      status: 'active',
    },
    {
      id: 'sibling-link',
      authUserId: 'parent-auth-1',
      email: 'jason@example.com',
      playerId: 'sibling',
      playerName: 'Sibling Bates',
      status: 'active',
    },
    {
      id: 'unsafe-link',
      authUserId: 'other-parent-auth',
      email: 'jason@example.com',
      playerId: 'other-child',
      playerName: 'Other Child',
      status: 'active',
    },
  ],
}

function activeLinkedChildrenForParent({ authUserId, email }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase()

  return multichildFixture.links.filter((link) =>
    link.authUserId === authUserId
    && link.status === 'active'
    && String(link.email ?? '').trim().toLowerCase() === normalizedEmail)
}

test('same parent email can identify multiple active child links for one parent account', () => {
  const links = activeLinkedChildrenForParent({
    authUserId: multichildFixture.authUserId,
    email: multichildFixture.parentEmail,
  })

  assert.deepEqual(links.map((link) => link.playerId).sort(), ['clyde', 'sibling'])
  assert.equal(links.some((link) => link.authUserId !== multichildFixture.authUserId), false)
})

test('existing confirmed parent auth user is reused through sign-in instead of duplicate signup', async () => {
  const source = await readFile(createParentAccountFunctionUrl, 'utf8')

  assert.match(source, /export function isConfirmedAuthUser\(user\)/)
  assert.match(source, /user\.email_confirmed_at \|\| user\.confirmed_at/)
  assert.match(source, /existingAccount: true/)
  assert.match(source, /needsEmailVerification: false/)
  assert.match(source, /Sign in to open this child link\./)
})

test('parent invite flow sends existing parent accounts to sign in with the child invite token', async () => {
  const [inviteSource, functionSource] = await Promise.all([
    readFile(parentInvitePageUrl, 'utf8'),
    readFile(createParentAccountFunctionUrl, 'utf8'),
  ])

  assert.match(functionSource, /return jsonResponse\(200, buildExistingParentAccountResponse\(\{ email \}\)\)/)
  assert.match(inviteSource, /result\?\.existingAccount/)
  assert.match(inviteSource, /parent-login\?parentInvite=\$\{encodeURIComponent\(token \|\| ''\)\}&existing=1/)
  assert.doesNotMatch(functionSource, /A user with this email address has already been registered/)
})

test('parent settings save treats current linked emails as idempotent and masks duplicate auth errors', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /function getLinkedParentEmails\(parentLinks = \[\]\)/)
  assert.match(source, /\.\.\.getLinkedParentEmails\(parentLinks\)/)
  assert.match(source, /if \(currentEmails\.has\(normalizedEmail\)\)/)
  assert.match(source, /Email already saved for this family portal account\./)
  assert.match(source, /That email is already linked to another login\./)
  assert.doesNotMatch(source, /No change made\. Enter a different email address\./)
})

test('parent portal selector continues to expose every linked child for one parent account', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /function ParentChildSelector\(\{ links, onSelect, otherLinks, selectedLink \}\)/)
  assert.match(source, /links\.map\(\(link\) => \(/)
  assert.match(source, /otherLinks\.map\(\(link\) => \(/)
  assert.match(source, /onClick=\{\(\) => onSelect\(link\.id\)\}/)
})

test('unsafe parent email takeover remains rejected by signed-in auth identity checks', async () => {
  const [portalSource, migration] = await Promise.all([
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(cleanupMigrationUrl, 'utf8'),
  ])

  assert.match(portalSource, /Sign in with that email to open its linked children/)
  assert.match(migration, /if target_link\.status = 'active' then[\s\S]*target_link\.auth_user_id is distinct from auth\.uid\(\)[\s\S]*already connected to another account/i)
  assert.match(migration, /existing\.auth_user_id = auth\.uid\(\)/i)
  assert.match(migration, /lower\(trim\(coalesce\(existing\.email, ''\)\)\) = auth_email/i)
})

test('existing single-child parent behavior still resolves to one linked child', () => {
  const singleChildLinks = activeLinkedChildrenForParent({
    authUserId: multichildFixture.authUserId,
    email: multichildFixture.parentEmail,
  }).filter((link) => link.playerId === 'clyde')

  assert.deepEqual(singleChildLinks.map((link) => link.playerId), ['clyde'])
})
