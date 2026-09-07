import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getRecoveryModuleForPath,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'

const cleanupMigrationUrl = migrationSourceUrl('20260616072046_20260616070626_harden_parent_portal_cleanup.sql', 'active')
const messagesMigrationUrl = new URL('../supabase/migrations/20260518153000_parent_portal_message_reads.sql', import.meta.url)
const revokeFamilyMigrationUrl = new URL('../supabase/migrations/20260516232000_parent_revoke_family_links.sql', import.meta.url)
const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const parentChatPageUrl = new URL('../src/pages/ParentChatPage.jsx', import.meta.url)
const parentChatWorkspaceUrl = new URL('../src/components/chat/ParentChatWorkspace.jsx', import.meta.url)
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
  assert.equal(getRecoveryModuleForPath('/parent-chat'), 'parentMessages')
  assert.equal(getRecoveryModuleForPath('/parent-messages'), 'parentMessages')
  assert.equal(getRecoveryModuleForPath('/friends-family'), 'familySharing')
  assert.equal(getRecoveryModuleForPath('/email-queue'), 'emailMessages')
  assert.equal(getRecoveryModuleForPath('/parent-email-templates'), 'emailMessages')

  assert.equal(isRecoveryPathVisible('/parent-chat', { user: parentUser() }), true)
  assert.equal(isRecoveryPathVisible('/parent-messages', { user: parentUser() }), true)
  assert.equal(isRecoveryPathVisible('/friends-family', { user: parentUser() }), true)
  assert.equal(isRecoveryPathVisible('/email-queue', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/parent-email-templates', { user: staffUser({ roleRank: 70 }) }), true)
})

test('Parent Portal replaces the email inbox with controlled Chat rooms', async () => {
  const [page, workspace] = await Promise.all([
    readFile(parentChatPageUrl, 'utf8'),
    readFile(parentChatWorkspaceUrl, 'utf8'),
  ])

  assert.match(page, /activeSection="chat"/)
  assert.match(workspace, /Chat with Coaches/)
  assert.match(workspace, /Team Chat/)
  assert.match(workspace, /Match Chats/)
  assert.match(workspace, /sendParentChatMessage/)
  assert.doesNotMatch(workspace, /getParentPortalMessages|markParentPortalMessageRead|Download PDF|View email|Parent inbox/i)
  assert.doesNotMatch(workspace, /inviteToken|invite_token|auth_user_id|parent_link_id/)
})

test('legacy parent email mirror RPCs remain fail closed while approved email systems are preserved', async () => {
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

test('legacy family route opens the controlled Fans experience', async () => {
  const legacy = await readFile(friendsFamilyPageUrl, 'utf8')
  const source = await readFile(new URL('../src/pages/FansPage.jsx', import.meta.url), 'utf8')
  assert.match(legacy, /FansPage as FriendsFamilyPage/)
  assert.match(source, /create_fan_invitation/)
  assert.match(source, /validateFanInvite/)
  assert.match(source, /Confirm Fan access/)
  assert.match(source, /Remove my access/)
})
