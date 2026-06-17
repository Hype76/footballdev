import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getRecoveryModuleForPath,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'

const cleanupMigrationUrl = new URL('../supabase/migrations/20260616070626_harden_parent_portal_cleanup.sql', import.meta.url)
const messagesMigrationUrl = new URL('../supabase/migrations/20260518153000_parent_portal_message_reads.sql', import.meta.url)
const revokeFamilyMigrationUrl = new URL('../supabase/migrations/20260516232000_parent_revoke_family_links.sql', import.meta.url)
const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const parentMessagesPageUrl = new URL('../src/pages/ParentMessagesPage.jsx', import.meta.url)
const friendsFamilyPageUrl = new URL('../src/pages/FriendsFamilyPage.jsx', import.meta.url)

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
    role: 'coach',
    roleRank: 30,
    ...overrides,
  }
}

test('batch 2 parent routes are surfaced without exposing staff email tools', () => {
  assert.equal(getRecoveryModuleForPath('/parent-messages'), 'parentMessages')
  assert.equal(getRecoveryModuleForPath('/friends-family'), 'familySharing')
  assert.equal(getRecoveryModuleForPath('/email-queue'), 'emailMessages')
  assert.equal(getRecoveryModuleForPath('/parent-email-templates'), 'emailMessages')

  assert.equal(isRecoveryPathVisible('/parent-messages', { user: parentUser() }), true)
  assert.equal(isRecoveryPathVisible('/friends-family', { user: parentUser() }), true)
  assert.equal(isRecoveryPathVisible('/email-queue', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/parent-email-templates', { user: staffUser({ roleRank: 70 }) }), true)
})

test('parent inbox remains read-only and tied to the selected child link', async () => {
  const source = await readFile(parentMessagesPageUrl, 'utf8')

  assert.match(source, /getParentPortalMessages\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(source, /markParentPortalMessageRead\(\{\s*parentLinkId: selectedLink\.id,/)
  assert.match(source, /Mark all as read/)
  assert.match(source, /Download PDF/)
  assert.doesNotMatch(source, /compose|reply|send message|send email|create email/i)
  assert.doesNotMatch(source, /inviteToken|invite_token|auth_user_id|parent_link_id/)
})

test('parent message RPCs fail closed to the signed-in active parent link', async () => {
  const migration = await readFile(messagesMigrationUrl, 'utf8')
  const cleanupMigration = await readFile(cleanupMigrationUrl, 'utf8')

  assert.match(migration, /where auth\.uid\(\) is not null/i)
  assert.match(migration, /link\.id = parent_link_id_value/i)
  assert.match(migration, /link\.auth_user_id = auth\.uid\(\)/i)
  assert.match(migration, /link\.status = 'active'/i)
  assert.match(migration, /link\.player_id = log\.player_id/i)
  assert.match(migration, /link\.club_id = log\.club_id/i)
  assert.match(migration, /log\.channel = 'email'/i)
  assert.match(migration, /log\.action = 'parent_email_sent'/i)
  assert.match(migration, /log\.id = communication_log_id_value/i)
  assert.match(cleanupMigration, /revoke execute on function public\.get_parent_portal_email_messages\(uuid\) from anon;/i)
  assert.match(cleanupMigration, /revoke execute on function public\.mark_parent_portal_message_read\(uuid, uuid\) from anon;/i)
  assert.match(cleanupMigration, /grant execute on function public\.get_parent_portal_email_messages\(uuid\) to authenticated;/i)
  assert.match(cleanupMigration, /grant execute on function public\.mark_parent_portal_message_read\(uuid, uuid\) to authenticated;/i)
})

test('friends and family sharing creates one child scoped pending link and supports revocation', async () => {
  const source = await readFile(friendsFamilyPageUrl, 'utf8')
  const domainSource = await readFile(parentPortalDomainUrl, 'utf8')
  const revokeMigration = await readFile(revokeFamilyMigrationUrl, 'utf8')
  const cleanupMigration = await readFile(cleanupMigrationUrl, 'utf8')

  assert.match(source, /createFamilyShareLink\(\{ parentLink: selectedLink \}\)/)
  assert.match(source, /getFamilyLinksForParentLink\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(source, /revokeFamilyPortalLink\(\{ linkId: familyLink\.id \}\)/)
  assert.match(source, /The link opens the selected child and nothing else\./)
  assert.match(source, /Family members cannot see staff tools, club settings, or another child\./)

  assert.match(domainSource, /\.eq\('parent_link_id', parentLink\.id\)/)
  assert.match(domainSource, /\.eq\('link_type', 'family'\)/)
  assert.match(domainSource, /\.eq\('status', 'pending'\)/)
  assert.match(domainSource, /club_id: parentLink\.clubId/)
  assert.match(domainSource, /team_id: parentLink\.teamId \|\| null/)
  assert.match(domainSource, /player_id: parentLink\.playerId/)
  assert.match(domainSource, /parent_link_id: parentLink\.id/)
  assert.match(domainSource, /link_type: 'family'/)
  assert.match(domainSource, /expires_at: new Date\(Date\.now\(\) \+ 24 \* 60 \* 60 \* 1000\)\.toISOString\(\)/)

  assert.match(revokeMigration, /family_link\.link_type = 'family'/i)
  assert.match(revokeMigration, /parent_link\.auth_user_id = auth\.uid\(\)/i)
  assert.match(revokeMigration, /parent_link\.status = 'active'/i)
  assert.match(revokeMigration, /parent_link\.player_id = family_link\.player_id/i)
  assert.match(cleanupMigration, /revoke execute on function public\.revoke_family_player_link\(uuid\) from anon;/i)
  assert.match(cleanupMigration, /grant execute on function public\.revoke_family_player_link\(uuid\) to authenticated;/i)
})
