import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source=readFileSync('apps/coach-mobile/src/CoachPhase31EScreens.js','utf8')
const start=source.indexOf('async (nextRoom) => {',source.indexOf('function ChatDomain('))
const end=source.indexOf('\n  }, [',start)+4
const body=source.slice(start,end)
assert.ok(body.startsWith('async')&&body.endsWith('}'))
const room={id:'11111111-1111-4111-8111-111111111111',kind:'parent'},key=`chatMessages:${room.kind}:${room.id}`
const saved=[{id:'message',body:'Private saved message'}]
function harness({offline=false,error=null,deferred=false}={}) {
 let messages=[],notice='',denials=0,network=0,mark=0,revision=1,release
 const user={id:'coach',isOfflineProfile:offline,getCoachAuthorityGeneration:()=>revision}
 const deps={openRequest:{current:0},activeRoomIdRef:{current:''},user,context:{id:'team'},
   peekMobileResource:()=>undefined,setMessages:value=>{messages=value},setRoomHistoryStale(){},setBody(){},setRoomId(){},setNotice:value=>{notice=value},
   readCoachOfflineResources:()=>deferred?new Promise(resolve=>{release=()=>resolve({resources:{[key]:saved}})}):Promise.resolve({resources:{[key]:saved}}),
   readMobileResource:async()=>{network++;if(error)throw error;return [{id:'live',body:'Live'}]},getCoachChatMessages:()=>{},
   clearClosedUnread:()=>{},createCoachOfflineResourceSaver:()=>async()=>{},markCoachChatRead:async()=>{mark++},load:async()=>{},reloadHome:async()=>{},
   denyRoom:()=>{denials++},getCoachFriendlyError:e=>e.message}
 return {open:new Function(...Object.keys(deps),`return (${body})`)(...Object.values(deps)),messages:()=>messages,notice:()=>notice,denials:()=>denials,network:()=>network,mark:()=>mark,release:()=>release(),invalidate:()=>{revision++}}
}
test('offline Parent room loads encrypted saved history without marking read',async()=>{
 const h=harness({offline:true});await h.open(room);assert.deepEqual(h.messages(),saved);assert.equal(h.network(),0);assert.equal(h.mark(),0);assert.match(h.notice(),/saved Chat history/)
})
test('transient failure retains saved room, while denial suppresses delayed cached data',async()=>{
 const h=harness({error:new Error('Network unavailable')});await h.open(room);assert.deepEqual(h.messages(),saved);assert.equal(h.mark(),0)
 const denied=harness({error:Object.assign(new Error('Denied'),{status:403}),deferred:true});await denied.open(room);denied.release();await Promise.resolve();assert.deepEqual(denied.messages(),[]);assert.equal(denied.denials(),1)
})
test('account authority change blocks delayed offline chat hydration',async()=>{
 const h=harness({offline:true,deferred:true});const pending=h.open(room);h.invalidate();h.release();await pending;assert.deepEqual(h.messages(),[])
})

test('closed Chat history is only requested on opening and a late response cannot cross teams', async () => {
  const start = source.indexOf('const loadClosedRooms = ')
  const end = source.indexOf('\n  const [roomId', start)
  const calls = []
  const room = { id: 'history', status: 'closed' }
  let authority = 1
  let state = { open: false, rooms: [], loading: false, error: '' }
  let complete
  const deps = {
    user: { id: 'coach', getCoachAuthorityGeneration: () => authority },
    context: { id: 'team' },
    closedRequest: { current: 0 },
    setClosedChat: value => { state = typeof value === 'function' ? value(state) : value },
    withMobileAsyncTimeout: loader => loader(),
    getCoachParentChatRooms: (_user, status) => {
      calls.push(status)
      return new Promise(resolve => { complete = resolve })
    },
    createCoachOfflineResourceSaver: () => async snapshot => calls.push(snapshot),
  }
  const loadHistory = new Function(...Object.keys(deps), source.slice(start, end) + '; return loadClosedRooms')(...Object.values(deps))
  assert.deepEqual(calls, [])
  const pending = loadHistory()
  assert.deepEqual(calls, ['closed'])
  assert.equal(state.loading, true)
  authority += 1
  complete([room])
  await pending
  assert.deepEqual(state.rooms, [])
  const next = loadHistory()
  complete([room])
  await next
  assert.deepEqual(state.rooms, [room])
  assert.deepEqual(calls.at(-1), { 'phase31e:chat-closed': [room] })
})
