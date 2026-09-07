import assert from 'node:assert/strict'
import test from 'node:test'
import { validateFanInvite,fanAccessSummary,fanInvitationStatus,PLAYER_INVITATIONS_ENABLED } from '../src/lib/fans.js'
import { buildFanScheduleEvents, canFanViewMatch } from '../netlify/functions/lib/_fan-schedule.js'
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
