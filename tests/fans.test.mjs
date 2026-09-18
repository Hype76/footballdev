import assert from 'node:assert/strict'
import test from 'node:test'
import { validateFanInvite,fanAccessSummary,fanInvitationStatus,PLAYER_INVITATIONS_ENABLED } from '../src/lib/fans.js'
import { addPublishedFormationPlans, buildFanScheduleEvents, canFanViewMatch } from '../netlify/functions/lib/_fan-schedule.js'
import { sanitizeParentOfflineProfile, setParentOfflineProfile, createParentOfflineDocument } from '../apps/mobile-core/src/parentOfflineCore.js'
test('Invite validation requires identity, allows Schedule alone and keeps Player hidden',()=>{
  assert.throws(()=>validateFanInvite({email:'a@example.test'}),/name/)
  assert.throws(()=>validateFanInvite({name:'Alex',email:'bad'}),/email/)
  const invite=validateFanInvite({name:' Alex ',email:'A@EXAMPLE.TEST',permissions:{schedule:true}})
  assert.equal(invite.email,'a@example.test')
  assert.equal(fanAccessSummary(invite.permissions).length,1)
  assert.throws(()=>validateFanInvite({...invite,relationship_type:'player'}),/not available/)
  assert.equal(PLAYER_INVITATIONS_ENABLED,false)
  assert.equal(fanInvitationStatus({status:'active',expires_at:'2000-01-01'}),'active')
  assert.equal(fanInvitationStatus({status:'pending',expires_at:'2000-01-01'}),'expired')
})
test('Schedule includes only shared occurrences and respects child exclusions', () => {
  const event = { id: 'training', title: 'Training', starts_at: '2026-09-07T17:00:00Z', ends_at: '2026-09-07T18:00:00Z', recurrence_frequency: 'weekly', recurrence_until: '2026-09-28', parent_visible: true, parent_audience: 'all_team_parents', team_id: 'team' }
  const args = { events: [event], invitedIds: new Set(), occurrences: [], exclusions: [], parent: { team_id: 'team' }, now: new Date('2026-09-07T12:00:00Z') }
  const schedule = buildFanScheduleEvents(args)
  assert.deepEqual(schedule.map((e) => e.date), ['2026-09-07','2026-09-14','2026-09-21','2026-09-28'])
  assert.equal(schedule[0].time, '18:00')
  assert.deepEqual(buildFanScheduleEvents({ ...args, parent: { team_id: 'other' } }), [])
  assert.deepEqual(buildFanScheduleEvents({ ...args, exclusions: [{ calendar_event_id: 'training', scope: 'this_and_future', effective_from_date: '2026-09-14' }] }).map((e) => e.date), ['2026-09-07'])
  const match = { id: 'match', club_id: 'club', team_id: 'team', parent_visible: true, parent_audience: 'involved_players' }
  assert.equal(canFanViewMatch(match, { club_id: 'club', team_id: 'team' }, new Set()), false)
  assert.equal(canFanViewMatch(match, { club_id: 'club', team_id: 'team' }, new Set(['match'])), true)
  assert.equal(canFanViewMatch({ ...match, parent_visible: false }, { club_id: 'club', team_id: 'team' }, new Set(['match'])), false)
})
test('Player Fan match access receives every authorised published board without private fields', async () => {
  const publications = [
    { match_day_id: 'match', publication_id: 'publication-a-old', board_id: 'board-a', board_title_snapshot: 'Old plan', board_version_id: 'version-a-old', publication_number: 1, withdrawn_at: null },
    { match_day_id: 'match', publication_id: 'publication-a', board_id: 'board-a', board_title_snapshot: 'Withdrawn replacement', board_version_id: 'version-a', publication_number: 2, withdrawn_at: '2026-09-18T10:00:00Z' },
    { match_day_id: 'match', publication_id: 'publication-b', board_id: 'board-b', board_title_snapshot: 'Late plan', board_version_id: 'version-b', publication_number: 2, withdrawn_at: null },
    { match_day_id: 'match', publication_id: 'publication-c', board_id: 'board-c', board_title_snapshot: 'Third plan', board_version_id: 'version-c', publication_number: 1, withdrawn_at: null },
  ]
  const versions = [
    { id: 'version-a-old', placements: [{ player_id: 'p0', display_name: 'Old Player' }], bench: [] },
    { id: 'version-a', placements: [{ player_id: 'p1', display_name: 'Player One', private_note: 'secret' }], bench: [] },
    { id: 'version-b', placements: [{ player_id: 'p2', display_name: 'Player Two', private_note: 'secret' }], bench: [] },
    { id: 'version-c', placements: [{ player_id: 'p3', display_name: 'Player Three' }], bench: [] },
  ]
  const calls = []
  const client = {
    from(table) {
      const rows = table === 'formation_board_match_publications' ? publications : versions
      const query = { select: () => query, eq: (key, value) => { calls.push(['eq', table, key, value]); return query }, in: (key, value) => { calls.push(['in', table, key, value]); return query }, is: () => query, order: () => query, range: () => query, then: (resolve) => resolve({ data: rows, error: null }) }
      return query
    },
  }
  const [match] = await addPublishedFormationPlans(client, { fan: { club_id: 'club', relationship_type: 'player' }, player: { team_id: 'team' } }, [{ id: 'match' }])
  assert.deepEqual(match.formation_plans.map((plan) => plan.board_title_snapshot), ['Late plan', 'Third plan'])
  assert.equal(match.formation_plan.publication_id, 'publication-b')
  assert.equal(JSON.stringify(match).includes('private_note'), false)
  assert.deepEqual(calls.filter(([type, table]) => type === 'eq' && table === 'formation_board_match_publications').map(([, , key, value]) => [key, value]), [['club_id', 'club'], ['team_id', 'team']])
  assert.deepEqual(calls.find(([type, table, key]) => type === 'in' && table === 'formation_board_match_publications' && key === 'match_day_id'), ['in', 'formation_board_match_publications', 'match_day_id', ['match']])
  const unchanged = await addPublishedFormationPlans({ from: () => { throw new Error('ordinary Fan must not query formations') } }, { fan: { club_id: 'club', relationship_type: 'fan' }, player: { team_id: 'team' } }, [{ id: 'match' }])
  assert.deepEqual(unchanged, [{ id: 'match' }])
})
test('Offline upgrade removes legacy Fan content and commands while retaining real Parent data', () => {
  const profile = { id: 'user', parentPortalLinks: [{ id:'parent',playerId:'one',linkType:'parent' }, { id:'legacy',playerId:'two',linkType:'family' }, { id:'fan',playerId:'three',linkType:'fan' }] }
  const sanitized = sanitizeParentOfflineProfile(profile)
  assert.deepEqual(sanitized.parentPortalLinks.map((p)=>p.id),['parent'])
  const document = createParentOfflineDocument({ profile, userScope:'user' })
  document.journal = [{ childScope:'legacy', payload:{private:'data'} },{childScope:'parent',status:'queued'}]
  document.resources = { legacy:{secret:true}, parent:{retained:true} }
  const next = setParentOfflineProfile(document,sanitized)
  assert.deepEqual(next.journal,[{childScope:'parent',status:'queued'}])
  assert.equal(JSON.stringify(next).includes('secret'),false)
})
