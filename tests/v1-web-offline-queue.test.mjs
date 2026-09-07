import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as security from '../src/lib/draft-security.js'
import { recoverFromStaleChunk } from '../src/lib/chunkRecovery.js'
function deferred() { let resolve; const promise=new Promise((done)=>{resolve=done});return {promise,resolve} }
function fixture() {
  const values=new Map(), calls=[]
  const storage={getItem:(key)=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:(key)=>values.delete(key)}
  const state={ gate:null }
  const createEvaluation=async(data)=>{calls.push(['create',data]);if(state.gate) await state.gate.promise}
  const updateEvaluation=async(id,data)=>{calls.push(['update',data,id]);if(state.gate) await state.gate.promise}
  const dependencies={...security,navigator:{onLine:true},window:undefined,createEvaluation,updateEvaluation}
  const source=readFileSync(new URL('../src/lib/offline-drafts.js',import.meta.url),'utf8').replace(/^import[\s\S]*? from ['"][^'"]+['"]\r?\n/gm,'').replace(/^export /gm,'').replace("  const { createEvaluation, updateEvaluation } = await import('./supabase.js')",'')
  const api=new Function(...Object.keys(dependencies),source+';return {saveDraft,syncDrafts,getQueuedDrafts,clearOfflineDraftsForUser}')(...Object.values(dependencies))
  const user={id:'user',clubId:'club',activeTeamId:'team',role:'admin',roleRank:90,accountStatus:'active'}
  const options={user,storage}
  return {api,options,state,calls}
}
test('legacy draft sync acknowledges only the sent version and updates the created server record on retry',async()=>{
  const f=fixture(),gate=deferred();f.state.gate=gate
  const draft={id:'draft',clubId:'club',teamId:'team',readyToSync:true,data:{id:'draft',teamId:'team',comments:'first'}}
  f.api.saveDraft(draft,f.options)
  const sync=f.api.syncDrafts(f.options)
  assert.equal(f.api.syncDrafts(f.options),sync)
  await Promise.resolve()
  f.api.saveDraft({...draft,data:{...draft.data,comments:'newer'}},f.options)
  gate.resolve();await sync
  assert.equal(f.calls.length,1)
  assert.equal(f.api.getQueuedDrafts(f.options)[0].data.comments,'newer')
  f.state.gate=null;await f.api.syncDrafts(f.options)
  assert.equal(f.calls[1][0],'update');assert.equal(f.calls[1][2],'draft')
  assert.equal(f.api.getQueuedDrafts(f.options).length,0)
})
test('clearing drafts during sync never repopulates them',async()=>{
  const f=fixture(),gate=deferred();f.state.gate=gate
  f.api.saveDraft({id:'draft',clubId:'club',teamId:'team',readyToSync:true,data:{teamId:'team'}},f.options)
  const sync=f.api.syncDrafts(f.options);await Promise.resolve()
  f.api.clearOfflineDraftsForUser(f.options.user,{storage:f.options.storage});gate.resolve();await sync
  assert.equal(f.api.getQueuedDrafts(f.options).length,0)
})
test('missing chunks while offline do not reload and discard the current page',()=>{
  const original=globalThis.window
  let reloads=0
  globalThis.window={navigator:{onLine:false},location:{reload(){reloads++}}}
  try {assert.equal(recoverFromStaleChunk(new Error('Failed to fetch dynamically imported module')),false);assert.equal(reloads,0)}
  finally {globalThis.window=original}
})
