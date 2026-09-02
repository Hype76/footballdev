import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import { requestGuestScorer, getGuestTimerRequest } from '../src/lib/guest-scorer.js'
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-key'
const { createGuestScorerHandler, hashGuestToken } = await import('../netlify/functions/guest-match-day-scorer.mjs')
const token = 'a'.repeat(64)
function request(body) { return new Request('https://footballplayer.online/.netlify/functions/guest-match-day-scorer', { method: 'POST', headers: { Authorization: 'Bearer coach-token' }, body: JSON.stringify(body) }) }

test('guest endpoint hashes capabilities, denies unsupported actions and never accepts a target match from the guest', async () => {
  const calls = []
  const handler = createGuestScorerHandler({ admin: { rpc: async (name, args) => { calls.push({ name, args }); return { data: { status: 'approved' } } } } })
  assert.equal((await handler(request({ action: 'delete_club', token }))).status,400)
  await handler(request({ action: 'read', token, matchId: 'foreign-match' }))
  assert.equal(calls[0].args.token_hash, hashGuestToken(token))
  assert.equal('matchId' in calls[0].args,false)
  assert.equal(JSON.stringify(calls).includes(token),false)
  assert.throws(() => hashGuestToken('short'),/invalid/)
})
test('claim hashes the resume secret before reaching the database', async () => {
  let args
  const handler = createGuestScorerHandler({ admin: { rpc: async (_, value) => { args=value; return { data:{status:'pending'} } } } })
  await handler(request({ action:'claim',token,details:{name:'Alex',sessionToken:'b'.repeat(64)} }))
  assert.deepEqual(args.details,{name:'Alex',sessionHash:hashGuestToken('b'.repeat(64))})
})
test('coach QR requires a verified account and database match authority', async () => {
  let claims
  const handler = createGuestScorerHandler({
    admin:{auth:{getUser:async()=>({data:{user:{id:'coach'}}})}},
    publicClient:(_, options)=>{ claims=options; return {rpc:async()=>({error:{code:'P0001',message:'Coach access to this match is required.'}})} },
    qr:async()=>{throw new Error('Must not create QR before authority')}
  })
  const result=await handler(request({mode:'coach',action:'create',matchId:'other-team'}))
  assert.equal(result.status,400)
  assert.equal(claims.global.headers.Authorization,'Bearer coach-token')
})
test('notification failure reports a saved score and preserves the request for retry', async () => {
  const handler=createGuestScorerHandler({admin:{rpc:async()=>({data:{saved:true,status:'approved',matchId:'scoped',commandId:'cmd'}})},notify:async()=>{throw new Error('provider unavailable')}})
  const data=await (await handler(request({action:'goal',token,requestId:'cmd'}))).json()
  assert.equal(data.saved,true); assert.match(data.notificationWarning,/was saved/)
  assert.equal(data.matchId,undefined)
})
test('fetch failures preserve the server error and clock requests cannot create staff actions',async()=>{
  await assert.rejects(requestGuestScorer({}, {fetcher:async()=>({ok:false,json:async()=>({message:'Coach approval required'})})}),/Coach approval required/)
  assert.deepEqual(getGuestTimerRequest('start'),{action:'start',details:{}})
  assert.deepEqual(getGuestTimerRequest('start_extra_time'),{action:'extended',details:{action:'start_extra_time'}})
})
test('SQL access contract retains parent date guards and keeps capability tables and functions private',async()=>{
  const files=await fs.readdir(new URL('../supabase/migrations/',import.meta.url))
  const file=files.find(x=>x.endsWith('_guest_match_day_scorer.sql'))
  const sql=await fs.readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')
  assert.match(sql,/select \(public.current_user_has_match_day_scorer_assignment\(target_match_day_id\) or private.is_guest_match_scorer\(target_match_day_id\)\)\s+and public.match_day_local_date_is_today/)
  assert.match(sql,/revoke all on function public.guest_match_day_scoring\(text,text,jsonb,uuid\) from public, anon, authenticated/)
  assert.match(sql,/alter table public.match_day_guest_sessions enable row level security/)
  assert.match(sql,/Only a coach can conclude the game/)
  assert.doesNotMatch(sql,/set_config\('request.jwt/)
})
