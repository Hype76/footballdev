import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL = 'https://adult-calendar.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
const { supabase } = await import('../src/lib/supabase-client.js')
const { normalizeAdultPlayerInvitation, respondToOwnAdultPlayerInvitation } = await import('../src/lib/domain/adult-player.js')

test('ordinary Calendar responses send only their exact invitation ID to the own-adult RPC', async t => {
  const calls = []
  t.mock.method(supabase, 'rpc', async (name, parameters) => {
    calls.push({ name, parameters })
    return { data: { success: true, responseState: parameters.response_value } }
  })
  const invitation = normalizeAdultPlayerInvitation({ source_record_id: 'own-invite', invitation_type: 'calendar_attendance' })
  for (const responseState of ['available', 'maybe', 'unavailable']) {
    const result = await respondToOwnAdultPlayerInvitation({ invitation, responseState })
    assert.equal(result.responseState, responseState)
  }
  assert.deepEqual(calls, ['available', 'maybe', 'unavailable'].map(response_value => ({
    name: 'respond_own_adult_player_calendar_invitation',
    parameters: { invite_id_value: 'own-invite', response_value },
  })))
})

test('Calendar server denial remains an error and informational records never issue a mutation', async t => {
  let calls = 0
  t.mock.method(supabase, 'rpc', async () => {
    calls++
    return { data: { success: false, denialCategory: 'response_window_closed', message: 'This Calendar response window has closed.' } }
  })
  await assert.rejects(respondToOwnAdultPlayerInvitation({ invitation: { sourceRecordId: 'closed-invite', invitationType: 'calendar_attendance' }, responseState: 'available' }), { code: 'response_window_closed' })
  await assert.rejects(respondToOwnAdultPlayerInvitation({ invitation: { sourceRecordId: 'old-information', invitationType: 'calendar_information' }, responseState: 'available' }), /does not require a response/)
  assert.equal(calls, 1)
})
