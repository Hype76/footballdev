import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('Match Day vote settings reach the scoped saved record and omitted fields remain untouched', async()=>{
  const source=await readFile('src/lib/domain/match-day.js','utf8')
  const start=source.indexOf('export async function updateMatchDay('),end=source.indexOf('function normalizeMatchDayTimerResult',start)
  let written,filters=[]
  const query={update:payload=>{written=payload;return query},eq:(...args)=>{filters.push(args);return query},is:()=>query,select:()=>query,single:async()=>({data:{id:'fixture',...written},error:null})}
  const context=vm.createContext({Date,Number,Boolean,Object,Error,console,
    blockDemoMutation:async()=>{},assertStaffMatchDayAccess:()=>{},getMatchDayEventLogSnapshot:async()=>({id:'fixture',status:'scheduled'}),
    normalizeBoolean:value=>value===true,applyScorerRequestMessageUpdate:()=>{},supabase:{from:table=>{assert.equal(table,'match_days');return query}},scopeMatchDayQueryToActiveTeam:q=>q,
    buildMatchSelect:()=>'*',invalidateMemoryCacheByPrefix:()=>{},normalizeMatchDay:x=>x,buildMatchDaySnapshotFromMatch:x=>x,buildChangedSnapshot:()=>({previousValue:{},newValue:{}}),createMatchDayEventLogEntry:async()=>{},getMatchDay:async()=>written})
  vm.runInContext(source.slice(start,end).replace('export async','async'),context)
  const run=updates=>context.updateMatchDay({user:{clubId:'club',activeTeamId:'team'},matchId:'fixture',updates})
  await run({enableMotmPoll:true,motmPollExpiryHours:12,motmNotifyResultsOnClose:true})
  assert.equal(written.enable_motm_poll,true);assert.equal(written.motm_poll_expiry_hours,12);assert.equal(written.motm_notify_results_on_close,true)
  assert.deepEqual(filters,[['id','fixture'],['club_id','club']])
  await run({enableMotmPoll:false,motmNotifyResultsOnClose:true})
  assert.equal(written.enable_motm_poll,false);assert.equal(written.motm_notify_results_on_close,false)
  await run({})
  assert.equal('enable_motm_poll' in written,false);assert.equal('motm_poll_expiry_hours' in written,false)
  await assert.rejects(run({motmPollExpiryHours:0}),/at least one hour/)
  await assert.rejects(run({motmPollExpiryHours:NaN}),/at least one hour/)
})
