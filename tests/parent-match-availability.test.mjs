import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { canChangeParentMatchAvailability, getParentMatchAttendanceInvitation, getParentMatchAvailability, getParentMatchSquadStatus } from '../apps/parent-mobile/src/parentMatchAvailability.js'
import {readCoachReminderProjections,projectCoachReminderMatches} from '../src/lib/coach-reminder-read-model.js'
const link = { id: 'parent', playerId: 'child', linkType: 'parent' }
const match = { id: 'match', status: 'scheduled' }
const invitation = { parentLinkId: 'parent', childId: 'child', eventId: 'match', invitationType: 'match_attendance', sourceRecordId: 'request', invitationState: 'active', canRespond: true }
test('availability and selection remain independent and unanswered copy is truthful', () => {
  for (const [availabilityStatus, label] of [['available','Available'],['unavailable','Not available'],['maybe','Maybe']]) {
    assert.equal(getParentMatchAvailability({...match,availabilityStatus},invitation,link).label,label)
  }
  assert.equal(getParentMatchAvailability(match,invitation,link).label,'Needs response')
  assert.equal(getParentMatchAvailability(match,{...invitation,invitationState:'expired'},link).label,'Not responded')
  assert.equal(getParentMatchAvailability(match,null,link).label,'No response requested')
  for (const [squadDecisionState,label] of [['selected','Selected'],['not_selected','Not selected'],['waiting','Not announced yet'],['undecided','Not announced yet']]) assert.equal(getParentMatchSquadStatus({...match,squadDecisionState}).label,label)
})
test('edit requires exact authorised Parent attendance request and a live response window', () => {
  assert.equal(getParentMatchAttendanceInvitation(match,[{...invitation,childId:'another'},invitation],link),invitation)
  assert.equal(canChangeParentMatchAvailability(match,invitation,link),true)
  for (const patch of [{sourceRecordId:''},{parentLinkId:'another'},{childId:'another'},{eventId:'another'},{invitationType:'match_role'},{invitationState:'cancelled'},{invitationState:'closed'},{canRespond:false},{responseDeadline:'2000-01-01'}]) assert.equal(canChangeParentMatchAvailability(match,{...invitation,...patch},link),false,JSON.stringify(patch))
  for (const linkType of ['fan','player','family','']) {
    assert.equal(getParentMatchAttendanceInvitation(match,[invitation],{...link,linkType}),null)
    assert.equal(canChangeParentMatchAvailability(match,invitation,{...link,linkType}),false)
  }
  for (const patch of [{status:'cancelled'},{status:'postponed'},{status:'full_time'},{concludedAt:'2026-09-16'},{isFanView:true}]) assert.equal(canChangeParentMatchAvailability({...match,...patch},invitation,link),false)
})

const dataSource = await readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url),'utf8')
const declarations = parse(dataSource,{sourceType:'module',plugins:['jsx']}).program.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
const functionSource = name => { const node = declarations.find(node => node?.type === 'FunctionDeclaration' && node.id.name === name); return dataSource.slice(node.start,node.end) }
test('data mutations reject unrelated child, Fan and Player before calling the existing RPC', async () => {
  const calls=[]
  const supabase={rpc:async(name,args)=>{calls.push({name,args});return {data:{saved:true}}}}
  const {setParentMatchTransport,respondToParentInvitation}=new Function('supabase',`
    const requireSelectedLink=user=>user.link,normalizeText=value=>String(value??'').trim();
    ${functionSource('isParentInvitationActionable')}
    ${functionSource('setParentMatchTransport')}
    ${functionSource('respondToParentInvitation')}
    return {setParentMatchTransport,respondToParentInvitation};`)(supabase)
  for(const badLink of [{...link,id:'other'},{...link,playerId:'other'},{...link,linkType:'fan'},{...link,linkType:'player'}]) {
    await assert.rejects(setParentMatchTransport({link:badLink},invitation,'needs_lift'),/Parent account/)
    await assert.rejects(respondToParentInvitation({link:badLink},invitation,'available'),/Parent account/)
  }
  assert.equal(calls.length,0)
  await setParentMatchTransport({link},invitation,'offering_lift',1)
  await respondToParentInvitation({link},invitation,'unavailable')
  assert.equal(calls[0].name,'set_parent_portal_match_transport')
  assert.equal(calls[0].args.request_id_value,'request')
  assert.equal(calls[1].name,'respond_parent_portal_match_day_invitation')
  assert.equal(calls[1].args.parent_link_id_value,'parent')
})

test('match loader merges fixture squad arrays using stable IDs and does not request private transport for readonly links', async () => {
  const calls=[]
  const supabase={rpc:async(name)=>{
    calls.push(name)
    const data={get_parent_portal_match_days:[{id:'match'}],get_parent_portal_match_squad_transport:[{match_day_id:'match',squad_players:[{player_id:'one',player_name:'Same name',needs_lift:true},{player_id:'two',player_name:'Same name',can_offer_lift:true}]}],get_parent_portal_confirmed_teams:[{match_day_id:'match',selected_player_names:['Same name','Same name']}]}
    return {data:data[name]||[]}
  }}
  const getParentPortalMatchDays=new Function('supabase',`const requireSelectedLink=user=>user.link,normalizeParentMatchDay=row=>row;${functionSource('getParentPortalMatchDays')};return getParentPortalMatchDays;`)(supabase)
  const [result]=await getParentPortalMatchDays({link})
  assert.deepEqual(result.squad_transport.map(player=>player.player_id),['one','two'])
  assert.equal(result.selected_player_names.length,2)
  calls.length=0
  await getParentPortalMatchDays({link:{...link,linkType:'player'}})
  assert.equal(calls.includes('get_parent_portal_match_squad_transport'),false)
})

test('Parent match loader keeps default-off reads intact and enables only selected-link reminder projections',async()=>{
  const calls=[],original={id:'match',availabilityStatus:'pending'}
  const supabase={rpc:async(name,args)=>{
    calls.push({name,args})
    return {data:name==='get_parent_portal_match_days'?[original]:name==='get_team_coach_reminder_projections_v1'?[{eventId:'match',playerId:'child',status:'unavailable',automatic:true,provenance:'coach_deadline_automation',planningExcluded:true}]:[],error:null}
  }}
  const runtime={env:{}}
  const load=new Function('process','supabase','readCoachReminderProjections','projectCoachReminderMatches',`const requireSelectedLink=user=>user.link,normalizeParentMatchDay=row=>row;${functionSource('getParentPortalMatchDays')};return getParentPortalMatchDays;`)(runtime,supabase,readCoachReminderProjections,projectCoachReminderMatches)
  const [disabled]=await load({link})
  assert.equal(disabled.availabilityStatus,'pending');assert.equal(disabled.availabilityAutomatic,undefined)
  assert.equal(calls.some(call=>call.name==='get_team_coach_reminder_projections_v1'),false)
  runtime.env.EXPO_PUBLIC_ENABLE_COACH_REMINDER_AUTOMATION='true'
  const [enabled]=await load({link})
  assert.equal(enabled.availabilityStatus,'unavailable');assert.equal(enabled.availabilityProvenance,'coach_deadline_automation')
  const projection=calls.find(call=>call.name==='get_team_coach_reminder_projections_v1')
  assert.equal(projection.args.parent_link_id_value,link.id);assert.deepEqual(projection.args.event_ids,['match'])
  assert.equal(original.availabilityStatus,'pending')
})
