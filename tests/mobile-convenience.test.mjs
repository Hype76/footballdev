import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeVenuePlaces, venueMapTiles } from '../apps/mobile-core/src/venueMapCore.js'
import { isFanMatchNotificationType, sendFanMatchNotifications } from '../netlify/functions/lib/_fan-push.js'
import { buildCoachCalendarPayload, coachCalendarFormFromEvent, normalizeCoachCalendarEvent } from '../apps/mobile-core/src/coachCalendarCore.js'

test('Fans cannot receive any poll invitation or result through game notifications', async () => {
  for (const type of ['parent_poll','poll_activity','poll_results','player_of_the_match','motm','motm_poll','potm','poll_invitation']) {
    assert.equal(isFanMatchNotificationType(type),false)
    const result = await sendFanMatchNotifications({ client: { from: () => { throw Error('Must not query Fan recipients') } }, match: {}, type, targetParentLinkIds:['parent'], sendPush:()=>{throw Error('Must not send')} })
    assert.deepEqual(result,{fanSent:0,fanFailed:0})
  }
  assert.equal(isFanMatchNotificationType('goal'),true)
  assert.equal(isFanMatchNotificationType('full_time'),true)
})

test('map previews reject invalid coordinates and request only visible tiles', () => {
  const items=normalizeVenuePlaces({features:[{geometry:{coordinates:[0,52]},properties:{name:'Pitch',city:'Cambridge'}},{geometry:{coordinates:[181,91]}},{geometry:{coordinates:['0',52]}}]})
  assert.deepEqual(items,[{longitude:0,latitude:52,label:'Pitch, Cambridge'}])
  for (const place of [items[0],{longitude:179.999,latitude:0},{longitude:-179.999,latitude:0}]) {
    const tiles=venueMapTiles(place,15,320)
    assert.ok(tiles.length<=6)
    assert.ok(tiles.every(tile=>tile.left<320&&tile.left+256>0&&tile.top<220&&tile.top+256>0))
    assert.ok(tiles.every(tile=>/^https:\/\/tile.openstreetmap.org\/15\/\d+\/\d+.png$/.test(tile.url)))
  }
})

test('pinned note choice survives event form round trip and clears for empty notes', () => {
  const event=normalizeCoachCalendarEvent({id:'event',notes:'Bring water',notes_pinned:true,starts_at:'2026-09-12T10:00:00Z',ends_at:'2026-09-12T11:00:00Z',event_type:'training',team_id:'team',title:'Training'})
  assert.equal(event.notesPinned,true)
  const form=coachCalendarFormFromEvent(event,{activeTeamId:'team'})
  assert.equal(form.notesPinned,true)
  const context={clubId:'club',activeTeamId:'team',role:'coach'}
  assert.equal(buildCoachCalendarPayload({form,context}).notes_pinned,true)
  assert.equal(buildCoachCalendarPayload({form:{...form,notes:''},context}).notes_pinned,false)
})
