import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addScopeToNotificationPayload,
  buildScopedNotificationTitle,
  hydrateNotificationScopeNames,
} from '../netlify/functions/lib/_notification-scope.js'
import {
  buildParentChatMobileNotification,
  buildParentPollMobileNotification,
  buildStaffChatMobileNotification,
} from '../netlify/functions/process-chat-mobile-notifications.js'

function createScopeClient() {
  return {
    from(table) {
      return {
        select() {
          return {
            async in() {
              if (table === 'clubs') return { data: [{ id: 'club-1', name: 'St Neots FC' }], error: null }
              if (table === 'teams') return { data: [{ id: 'team-1', club_id: 'club-1', name: 'U17 Green' }], error: null }
              return { data: [], error: null }
            },
          }
        },
      }
    },
  }
}

test('notification titles identify both the authoritative club and team', () => {
  assert.equal(
    buildScopedNotificationTitle('Team Chat', { clubName: 'St Neots FC', teamName: 'U17 Green' }),
    'St Neots FC | U17 Green | Team Chat',
  )

  const intent = {
    club_name: 'St Neots FC',
    team_name: 'U17 Green',
    club_id: 'club-1',
    team_id: 'team-1',
  }
  assert.equal(buildParentChatMobileNotification({ ...intent, recipient_app: 'parent', room_type: 'team' }).title, 'St Neots FC | U17 Green | Team Chat')
  assert.equal(buildStaffChatMobileNotification({ ...intent, conversation_type: 'team_staff' }).title, 'St Neots FC | U17 Green | Team Coach Chat')
  assert.equal(buildParentPollMobileNotification(intent).title, 'St Neots FC | U17 Green | Football Player Parents')
})

test('scope names are loaded from authoritative ids and included in notification deep-link data', async () => {
  const client = createScopeClient()
  const [scope] = await hydrateNotificationScopeNames(client, [{ club_id: 'club-1', team_id: 'team-1' }])
  assert.equal(scope.club_name, 'St Neots FC')
  assert.equal(scope.team_name, 'U17 Green')

  const payload = await addScopeToNotificationPayload(client, {
    clubId: 'club-1',
    data: { route: 'invites' },
    teamId: 'team-1',
    title: 'Training response requested',
  })
  assert.equal(payload.title, 'St Neots FC | U17 Green | Training response requested')
  assert.deepEqual(payload.data, {
    clubName: 'St Neots FC',
    route: 'invites',
    teamName: 'U17 Green',
  })
})
