import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  canResendSelectedCoachInvites,
  getSelectedCoachInvites,
  toggleCoachInvitePlayerSelection,
} from '../apps/mobile-core/src/coachPhase31ECore.js'

const invites = [
  { id: 'invite-1', eventId: 'match-1', playerId: 'player-1', playerName: 'Alex', status: 'pending' },
  { id: 'invite-2', eventId: 'match-1', playerId: 'player-2', playerName: 'Blair', status: 'awaiting' },
  { id: 'invite-3', eventId: 'match-1', playerId: 'player-3', playerName: 'Casey', status: 'available' },
]

test('Coach availability selection toggles multiple Players without duplicates', () => {
  let selected = toggleCoachInvitePlayerSelection([], 'player-1')
  selected = toggleCoachInvitePlayerSelection(selected, 'player-2')
  selected = toggleCoachInvitePlayerSelection(selected, 'player-2')
  selected = toggleCoachInvitePlayerSelection(selected, 'player-3')
  assert.deepEqual(selected, ['player-1', 'player-3'])
  assert.deepEqual(getSelectedCoachInvites(invites, selected).map((invite) => invite.playerId), ['player-1', 'player-3'])
})

test('bulk resend requires every selected Player to be awaiting a response', () => {
  assert.equal(canResendSelectedCoachInvites(invites.slice(0, 2)), true)
  assert.equal(canResendSelectedCoachInvites([invites[0], invites[2]]), false)
  assert.equal(canResendSelectedCoachInvites([]), false)
})

test('Coach availability screen exposes accessible bulk resend and removal controls', async () => {
  const screen = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
  assert.match(screen, /accessibilityRole="checkbox"/)
  assert.match(screen, /accessibilityState=\{\{ checked: selected, disabled: selectionDisabled \}\}/)
  assert.match(screen, /Resend \$\{selectedInvites\.length\} invite/)
  assert.match(screen, /Remove \$\{selectedInvites\.length\} from event/)
  assert.match(screen, /No removal notification will be sent/)
  assert.match(screen, /failed and remain selected so you can review them/)
})

test('bulk event removal reuses the canonical history-preserving RPC without a new server contract', async () => {
  const data = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  assert.match(data, /rpc\('preview_event_player_removal'/)
  assert.match(data, /rpc\('remove_player_from_event'/)
  assert.match(data, /invite\?\.kind === 'training' \? 'occurrence' : 'event'/)
  assert.match(data, /request_token_value: normalize\(requestToken\) \|\| requestId\('coach-invite-removal'\)/)
  assert.doesNotMatch(data.slice(data.indexOf('export async function previewCoachInviteRemoval')), /sendEmail|sendSms|sendParentMobilePushNotification/i)
})
