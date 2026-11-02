import test from 'node:test'
import assert from 'node:assert/strict'
import { getCurrentCancellationRecipients } from '../netlify/functions/lib/_cancelled-change-recipients.js'

function dbFor(tables, trainingIds = [], authorizedIds = null) {
  return {
    rpc: async (name, args) => ({ data: (name === 'get_authorized_notification_parent_links' ? authorizedIds ?? args.parent_link_ids_value : trainingIds).map(parent_link_id => ({ parent_link_id })), error: null }),
    from(name) {
      let rows = tables[name] || []
      const query = {
        select() { return query },
        eq(key, value) { rows = rows.filter(row => row[key] === value); return query },
        neq(key, value) { rows = rows.filter(row => row[key] !== value); return query },
        in(key, values) { rows = rows.filter(row => values.includes(row[key])); return query },
        then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
      }
      return query
    },
  }
}

test('cancellation delivery rechecks visibility and exact invited contact after preparation', async () => {
  const links = ['parent-a', 'parent-b'].map(id => ({ id, player_id: 'player', team_id: 'team', club_id: 'club', status: 'active' }))
  const invite = { parent_link_id: 'parent-a', player_id: 'player', team_id: 'team', club_id: 'club', calendar_event_id: 'event', invite_status: 'active' }
  const tables = { parent_player_links: links, calendar_event_invites: [invite] }
  const options = { clubId: 'club', teamId: 'team', sourceId: 'event', sourceType: 'calendar', source: { event_type: 'general', parent_visible: true, parent_audience: 'involved_players' }, preparedIds: links.map(link => link.id) }
  assert.deepEqual(await getCurrentCancellationRecipients(dbFor(tables), options), ['parent-a'])
  assert.deepEqual(await getCurrentCancellationRecipients(dbFor(tables, [], []), options), [])
  invite.invite_status = 'cancelled'
  assert.deepEqual(await getCurrentCancellationRecipients(dbFor(tables), options), [])
  invite.invite_status = 'active'
  options.source.parent_visible = false
  assert.deepEqual(await getCurrentCancellationRecipients(dbFor(tables), options), [])
  options.source.parent_visible = true
  options.source.parent_audience = 'none'
  assert.deepEqual(await getCurrentCancellationRecipients(dbFor(tables), options), [])
  options.source.parent_audience = 'involved_players'
  links[0].status = 'revoked'
  assert.deepEqual(await getCurrentCancellationRecipients(dbFor(tables), options), [])
})

test('training snapshot is intersected with prepared and currently active parent links', async () => {
  const tables = { parent_player_links: [{ id: 'parent-a', player_id: 'player', team_id: 'team', club_id: 'club', status: 'active' }, { id: 'parent-b', player_id: 'player', team_id: 'team', club_id: 'club', status: 'active' }] }
  const options = { clubId: 'club', teamId: 'team', sourceId: 'event', sourceType: 'calendar', source: { event_type: 'training', cancelled_at: '2027-01-01T00:00:00Z', parent_visible: true, parent_audience: 'involved_players' }, preparedIds: ['parent-a'] }
  assert.deepEqual(await getCurrentCancellationRecipients(dbFor(tables, ['parent-a', 'parent-b']), options), ['parent-a'])
  assert.deepEqual(await getCurrentCancellationRecipients(dbFor(tables, []), options), [])
})
