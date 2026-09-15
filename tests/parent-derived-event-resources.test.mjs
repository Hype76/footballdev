import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { listAuthorisedCalendarEventResources, loadAuthorisedResource, loadParentDerivedResourceEvents, validateParentDerivedEventResourceAccess } from '../netlify/functions/parent-resource-access.js'
import { buildParentCalendarEvents } from '../apps/mobile-core/src/parentCalendarCore.js'

const parentLink = { id: 'family', auth_user_id: 'auth', club_id: 'club', team_id: 'team', player_id: 'child', status: 'active' }
const player = { id: 'child', club_id: 'club', team_id: 'team', status: 'active' }
const match = { id: 'fixture', club_id: 'club', team_id: 'team', match_date: '2026-09-19', status: 'scheduled' }
const session = { id: 'session', club_id: 'club', team_id: 'team', session_date: '2026-09-20', status: 'open' }
const invitation = { event_id: 'session', source_event_type: 'assessment_session', parent_link_id: 'family', child_id: 'child', invitation_state: 'active', event_date: '2026-09-20' }
const resource = { id: 'resource', club_id: 'club', team_id: 'team', storage_bucket: 'resource-library', storage_path: 'club/team/resource/plan.pdf' }
function stub(tables = {}, rpcRows = {}) {
  const calls = []
  function query(key, args, rpc = false) {
    const call = { key, args, rpc, steps: [] }; calls.push(call)
    const result = { data: (rpc ? rpcRows : tables)[key] ?? (rpc ? [] : null), error: null }
    const value = new Proxy({}, { get(_, method) {
      if (method === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject)
      return (...params) => {
        call.steps.push([method, ...params])
        if (method === 'range') result.data = (result.data || []).slice(params[0], params[1] + 1)
        return value
      }
    } })
    return value
  }
  return { calls, from: (key) => query(key), rpc: (key, args) => query(key, args, true) }
}
function fixture(sourceType = 'match_day') {
  const event = sourceType === 'match_day' ? match : session
  const date = event.match_date || event.session_date
  return {
    authUserId: 'auth', parentLink, player, resource,
    calendarEvent: { ...event, authorised: true, resourceSourceType: sourceType, occurrenceDate: date },
    calendarOccurrenceDate: date,
    resourceLink: { id: 'assignment', resource_id: 'resource', club_id: 'club', team_id: 'team', linked_type: sourceType, linked_id: event.id, calendar_occurrence_date: null },
  }
}
for (const sourceType of ['match_day', 'assessment_session']) {
  test(`${sourceType} access requires exact current family, visible event, resource and occurrence`, () => {
    const records = fixture(sourceType)
    assert.equal(validateParentDerivedEventResourceAccess(records).accessType, 'file')
    for (const mutation of [
      { authUserId: 'other' }, { parentLink: { ...parentLink, status: 'revoked' } },
      { parentLink: { ...parentLink, team_id: 'other' } }, { player: { ...player, status: 'archived' } },
      { calendarEvent: { ...records.calendarEvent, authorised: false } },
      { calendarEvent: { ...records.calendarEvent, team_id: 'other' } },
      { calendarOccurrenceDate: '2026-09-21' },
      { resourceLink: { ...records.resourceLink, linked_type: 'calendar_event' } },
      { resourceLink: { ...records.resourceLink, linked_id: 'other' } },
      { resourceLink: { ...records.resourceLink, removed_at: 'removed' } },
      { resource: { ...resource, club_id: 'other' } }, { resource: { ...resource, archived_at: 'archived' } },
      { resource: { ...resource, storage_path: 'other/team/private.pdf' } },
      { externalLink: { resource_id: 'resource', club_id: 'club', team_id: 'team', external_url: 'javascript:alert(1)' } },
    ]) assert.throws(() => validateParentDerivedEventResourceAccess({ ...records, ...mutation }), /not available/)
  })
  test(`${sourceType} actual access loader reuses authenticated canonical visibility before resolving the file`, async () => {
    const records = fixture(sourceType)
    const admin = stub({ parent_player_links: parentLink, players: player, assessment_sessions: [session], resource_library_links: records.resourceLink, resource_library_items: resource })
    const parent = stub({}, { get_parent_portal_match_days: [match], get_parent_portal_invitation_state: [invitation] })
    const result = await loadAuthorisedResource({ authUserId: 'auth', parentLinkId: 'family', resourceId: 'resource', calendarEventId: records.calendarEvent.id, calendarOccurrenceDate: records.calendarOccurrenceDate, calendarSourceType: sourceType, supabaseAdmin: admin, parentClient: parent })
    assert.equal(result.access.accessType, 'file')
    assert.ok(parent.calls.every(call => call.rpc && call.args.parent_link_id_value === 'family'))
    assert.ok(admin.calls.every(call => !call.rpc))
    const steps = admin.calls.find(call => call.key === 'resource_library_links').steps
    for (const [column, value] of [['club_id', 'club'], ['team_id', 'team'], ['linked_type', sourceType], ['linked_id', records.calendarEvent.id]]) assert.ok(steps.some(step => step[0] === 'eq' && step[1] === column && step[2] === value))
    assert.ok(steps.some(step => step[0] === 'is' && step[1] === 'calendar_occurrence_date' && step[2] === null))
    await assert.rejects(() => loadAuthorisedResource({ authUserId: 'auth', parentLinkId: 'family', resourceId: 'resource', calendarEventId: records.calendarEvent.id, calendarOccurrenceDate: records.calendarOccurrenceDate, calendarSourceType: sourceType, supabaseAdmin: admin, parentClient: stub() }), /not available/)
  })
}

test('derived metadata fails closed for wrong child, revoked invitation, cancelled, moved, or foreign events', async () => {
  const parent = stub({}, { get_parent_portal_match_days: [match, { ...match, id: 'foreign', team_id: 'other' }, { ...match, id: 'cancelled', status: 'cancelled' }], get_parent_portal_invitation_state: [invitation, { ...invitation, event_id: 'wrong-child', child_id: 'other' }, { ...invitation, event_id: 'revoked', invitation_state: 'cancelled' }, { ...invitation, event_id: 'moved' }] })
  const admin = stub({ assessment_sessions: [session, { ...session, id: 'wrong-child' }, { ...session, id: 'revoked' }, { ...session, id: 'moved', session_date: '2026-09-21' }] })
  const result = await loadParentDerivedResourceEvents({ parentLink, player, parentClient: parent, supabaseAdmin: admin })
  assert.deepEqual(result.map(event => event.id), ['fixture', 'session'])
})

test('Parent calendar keeps match attachments and source identity through presentation and access', async () => {
  const attachments = [{ id: 'resource', eventId: 'fixture', occurrenceDate: '2026-09-19', sourceType: 'match_day' }]
  const result = buildParentCalendarEvents({ matches: [{ id: 'fixture', matchDate: '2026-09-19', resources: attachments }] })
  assert.deepEqual(result[0].resources, attachments)
  const [app, data, endpoint] = await Promise.all(['apps/parent-mobile/App.js', 'apps/parent-mobile/src/parentPortalData.js', 'netlify/functions/parent-resource-access.js'].map(path => readFile(path, 'utf8')))
  assert.match(app, /calendarSourceType: resource\.sourceType/)
  assert.match(data, /sourceType: normalizeText\(resource\.sourceType/)
  assert.match(endpoint, /global: \{ headers: \{ Authorization: `Bearer \$\{accessToken\}` \} \}/)
})


test('metadata lists null-date derived links with current source dates and no private storage paths', async () => {
  const futureMatch = { ...match, match_date: '2099-09-19' }
  const futureSession = { ...session, session_date: '2099-09-20' }
  const futureInvitation = { ...invitation, event_date: '2099-09-20' }
  const links = [fixture('match_day').resourceLink, { ...fixture('assessment_session').resourceLink, resource_id: 'session-resource' }, { ...fixture('match_day').resourceLink, resource_id: 'invalid', calendar_occurrence_date: '2099-09-19' }]
  const admin = stub({ parent_player_links: parentLink, players: player, calendar_events: [], assessment_sessions: [futureSession], resource_library_links: links, resource_library_items: [{ ...resource, title: 'Match plan' }, { ...resource, id: 'session-resource', title: 'Session plan' }], resource_library_external_links: [] })
  const parent = stub({}, { get_parent_portal_match_days: [futureMatch], get_parent_portal_invitation_state: [futureInvitation] })
  const rows = await listAuthorisedCalendarEventResources({ authUserId: 'auth', parentLinkId: 'family', supabaseAdmin: admin, parentClient: parent })
  assert.deepEqual(rows.map(row => [row.sourceType, row.eventId, row.occurrenceDate]), [['match_day', 'fixture', '2099-09-19'], ['assessment_session', 'session', '2099-09-20']])
  assert.ok(rows.every(row => !Object.hasOwn(row, 'storage_path')))
  assert.ok(parent.calls.every(call => call.steps.some(step => step[0] === 'gte')))
  assert.ok(admin.calls.find(call => call.key === 'resource_library_links').steps.some(step => step[0] === 'range'))
})
