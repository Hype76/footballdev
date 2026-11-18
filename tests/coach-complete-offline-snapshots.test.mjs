import assert from 'node:assert/strict'
import test from 'node:test'
import { boundCoachOfflineResource, COACH_OFFLINE_READ_POLICIES, COACH_PHASE_31F_MAX_CACHE_BYTES, getCoachOfflineReadPolicy } from '../apps/mobile-core/src/coachPhase31FCore.js'
import { createCoachOfflineDocument, getCoachOfflineResources, setCoachOfflineResources } from '../apps/mobile-core/src/coachOfflineCore.js'
const uuid = '00000000-0000-4000-8000-000000000001'
const context = { id: 'team:'+uuid, clubId: uuid, teamId: uuid, role:'coach', authorityId:uuid, authoritySource:'team_staff' }
const rows = Array.from({length:701},(_,id)=>({id,notes:'Retained row '+id}))

test('all classified collections and nested histories retain the complete supplied snapshot', () => {
 for(const key of Object.keys(COACH_OFFLINE_READ_POLICIES).filter(key=>!key.startsWith('invites'))) {
  const value={rows,history:rows,messages:rows,nested:{events:rows,responses:rows,timeline:rows}}
  assert.deepEqual(boundCoachOfflineResource(key,value),value,key)
  assert.equal(getCoachOfflineReadPolicy(key).maxItems,null)
 }
 assert.equal(COACH_PHASE_31F_MAX_CACHE_BYTES,500_000_000)
})

test('exact detail UUID policies persist every player, session and chat message row without accepting unknown keys', () => {
 const keys=['playerDetail:'+uuid,'sessionDetail:'+uuid,'chatMessages:staff:'+uuid,'chatMessages:parent:'+uuid]
 const values=Object.fromEntries(keys.map(key=>[key,{rows,history:rows}]))
 const stored=setCoachOfflineResources(createCoachOfflineDocument({userScope:'coach'}),context,values)
 assert.deepEqual(getCoachOfflineResources(stored,context).resources,values)
 assert.equal(stored.contexts[context.id].resourceMetadata[keys[0]].sensitivity,'child-data')
 assert.equal(stored.contexts[context.id].resourceMetadata[keys[3]].sensitivity,'private-communication')
 for(const key of ['unknown','playerDetail:not-a-uuid','sessionDetail:'+uuid+':extra','chatMessages:public:'+uuid,'chatMessages:staff:'+uuid+'/other','playerDetail:']) {
  assert.equal(getCoachOfflineReadPolicy(key).cache,false,key)
  assert.equal(boundCoachOfflineResource(key,rows),null,key)
 }
})

test('complete oversized snapshots fail atomically without discarding protected work or claiming a partial save', () => {
 const document={...createCoachOfflineDocument({userScope:'coach'}),developmentDrafts:{[context.id]:{items:{draft:{status:'pending',notes:'Unsynced'}}}},matchDayOutboxes:{[context.id]:{match:{pending:[{id:'goal'}]}}}}
 const before=structuredClone(document)
 const large=Array.from({length:500},(_,id)=>({id,body:'x'.repeat(100)}))
 assert.throws(()=>setCoachOfflineResources(document,context,{chat:{messages:large}},undefined,20_000),/offline_cache_payload_too_large/)
 assert.deepEqual(document,before)
})

test('budget recovery evicts whole reconstructible entries while preserving complete new data and journals', () => {
 let document=createCoachOfflineDocument({userScope:'coach'})
 document=setCoachOfflineResources(document,context,{home:{payload:'x'.repeat(15_000)}},'2026-11-18T10:00:00Z',25_000)
 document={...document,developmentDrafts:{[context.id]:{items:{draft:{status:'pending',notes:'Unsynced'}}}},matchDayOutboxes:{[context.id]:{match:{pending:[{id:'goal'}]}}}}
 const next=setCoachOfflineResources(document,context,{chat:{messages:rows}},'2026-11-18T11:00:00Z',40_000)
 assert.equal(next.contexts[context.id].resources.chat.messages.length,rows.length)
 assert.equal(next.contexts[context.id].resources.home,undefined)
 assert.deepEqual(next.developmentDrafts,document.developmentDrafts)
 assert.deepEqual(next.matchDayOutboxes,document.matchDayOutboxes)
})
