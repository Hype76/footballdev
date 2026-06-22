import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getRecoveryModuleForPath,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'

const pollVisibilityMigrationUrl = new URL('../supabase/archived-migrations/not-applied-production/20260617191000_harden_parent_poll_vote_visibility.sql', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const parentLinkingPageUrl = new URL('../src/pages/ParentLinkingPage.jsx', import.meta.url)
const parentPollsPageUrl = new URL('../src/pages/ParentPollsPage.jsx', import.meta.url)

function parentUser(overrides = {}) {
  return {
    role: 'parent_portal',
    roleRank: 0,
    ...overrides,
  }
}

function staffUser(overrides = {}) {
  return {
    clubId: 'club-1',
    activeTeamId: 'team-1',
    planKey: 'club',
    planStatus: 'active',
    role: 'coach',
    roleRank: 30,
    ...overrides,
  }
}

function getFunctionSection(source, functionName) {
  const start = source.indexOf(`function ${functionName}()`)
  assert.notEqual(start, -1, `${functionName} should exist`)
  const nextFunction = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction)
}

test('batch 1 routes are surfaced without raising all recovery gates', () => {
  assert.equal(getRecoveryModuleForPath('/parent-polls'), 'pollsAvailability')
  assert.equal(getRecoveryModuleForPath('/polls'), 'pollsAvailability')
  assert.equal(getRecoveryModuleForPath('/parent-linking'), 'parentInvites')
  assert.equal(getRecoveryModuleForPath('/friends-family'), 'familySharing')
  assert.equal(getRecoveryModuleForPath('/parent-messages'), 'parentMessages')

  assert.equal(isRecoveryPathVisible('/parent-polls', { user: parentUser() }), true)
  assert.equal(isRecoveryPathVisible('/polls', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/parent-linking', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/end-season-stats', { user: staffUser({ roleRank: 70 }) }), true)
})

test('batch 1 route guards still require role permission after recovery visibility', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const pollSection = getFunctionSection(source, 'RequirePollAccess')
  const parentLinkSection = getFunctionSection(source, 'RequireParentLinkingAccess')

  assert.match(pollSection, /isRecoveryModuleVisible\('pollsAvailability', \{ user \}\)/)
  assert.match(pollSection, /canManagePolls\(user\)/)
  assert.match(parentLinkSection, /isRecoveryModuleVisible\('parentInvites', \{ user \}\)/)
  assert.match(parentLinkSection, /canManageParentLinks\(user\)/)
})

test('parent poll totals stay out of hidden vote payloads until the parent has replied', async () => {
  const migration = await readFile(pollVisibilityMigrationUrl, 'utf8')

  assert.match(migration, /when poll\.hide_votes is true and own_votes\.poll_id is null then '\[\]'::jsonb/i)
  assert.match(migration, /and auth_user_id = auth\.uid\(\)/i)
  assert.match(migration, /and status = 'active'/i)
  assert.match(migration, /and \(poll\.team_id is null or poll\.team_id = link\.team_id\)/i)
  assert.match(migration, /and poll\.audience = 'parents'/i)
  assert.match(migration, /and poll\.status = 'open'/i)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_polls\(uuid\) from anon;/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_polls\(uuid\) to authenticated;/i)
  assert.doesNotMatch(migration, /grant execute on function public\.get_parent_portal_polls\(uuid\) to anon;/i)
})

test('parent invite management remains squad-only and does not expose token fields in UI copy', async () => {
  const source = await readFile(parentLinkingPageUrl, 'utf8')

  assert.match(source, /filter\(isSquadPlayer\)/)
  assert.match(source, /Squad players only/)
  assert.match(source, /Status: \{link\.status\}, Access: \{link\.linkType\}/)
  assert.doesNotMatch(source, /inviteToken|invite_token|auth_user_id|parent_link_id/)
})

test('parent polls use parent-safe copy and selected-child context', async () => {
  const source = await readFile(parentPollsPageUrl, 'utf8')

  assert.match(source, /Select the right child/)
  assert.match(source, /No parent polls are open for this child right now/)
  assert.match(source, /Own child not available/)
  assert.match(source, /selectedLink\.id/)
  assert.doesNotMatch(source, /recovery phase|debug mode|\brpc\b|\brls\b/i)
})
