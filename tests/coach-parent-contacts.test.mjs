import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildCoachPlayerPayload, coachPlayerFormFromPlayer, getCoachPlayerSensitiveFieldPolicy, normalizeCoachPlayer } from '../apps/mobile-core/src/coachPlayersCore.js'
import { isParentPortalInviteEligiblePlayer, normalizeParentPortalInviteEmail } from '../src/lib/parent-portal-invite-actions.js'

const user = {id:'coach',clubId:'club',activeTeamId:'team',roleRank:50,hasActivePlanAccess:true}
const assertRead=(u)=>{if(!u?.id||!u.clubId||!u.activeTeamId||u.roleRank<20)throw Error('Unauthorized')}
const assertMutation=(u)=>{assertRead(u);if(!u.hasActivePlanAccess)throw Error('Read only')}
async function load(file,names,deps){const source=(await readFile(file,'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'').replace(/export /g,'');return new Function(...Object.keys(deps),source+';return {'+names.join(',')+'}')( ...Object.values(deps))}
function client(results){const calls=[];return{calls,from(table){const call={table,steps:[]};calls.push(call);const query=new Proxy({}, {get(_,key){if(key==='then')return(resolve,reject)=>Promise.resolve(results.shift()||{data:[],error:null}).then(resolve,reject);return(...args)=>{call.steps.push([key,...args]);return query}}});return query},rpc(name,args){calls.push({rpc:name,args});const query=new Proxy({}, {get(_,key){if(key==='then')return(resolve,reject)=>Promise.resolve(results.shift()||{data:[],error:null}).then(resolve,reject);return(...args)=>{calls.at(-1).steps ||= [];calls.at(-1).steps.push([key,...args]);return query}}});return query}}}
async function parentApi(db,sends=[]){return load('apps/mobile-core/src/coachParentContactsData.js',['sendCoachParentInvite','revokeCoachParentAccess','getCoachParentLinks'],{supabase:db,CAPABILITIES:{parentInvitations:'parentInvitations'},assertCoachCapability:()=>{},assertCoachOperationalRead:assertRead,assertCoachOperationalMutation:assertMutation,isParentPortalInviteEligiblePlayer,normalizeParentPortalInviteEmail,getMobileRuntimeConfig:()=>({apiBaseUrl:'https://example.test'}),joinApiPath:(b,p)=>b+'/'+p,getAccessToken:async()=> 'synthetic-token',fetchJsonWithTimeout:async(url,options)=>{sends.push({url,options});return{ok:true,result:{success:true}}}})}
const row={id:'player',section:'Squad',status:'active',parent_contacts:[{name:'Parent',email:'parent@example.test'}]}

test('selected activeTeamId exposes contacts while absent team and low rank remain denied',()=>{
 assert.equal(getCoachPlayerSensitiveFieldPolicy(user).canViewContactDetails,true)
 assert.equal(getCoachPlayerSensitiveFieldPolicy({...user,activeTeamId:''}).canViewContactDetails,false)
 assert.equal(getCoachPlayerSensitiveFieldPolicy({...user,roleRank:0}).canViewContactDetails,false)
 assert.equal(normalizeCoachPlayer({...row,parent_contacts:[],parent_email:'legacy@example.test'}).parentContacts[0].email,'legacy@example.test')
})
test('editing one parent preserves other contacts; removing all clears primary fallback',()=>{
 const player=normalizeCoachPlayer({...row,parent_contacts:[...row.parent_contacts,{name:'Second',email:'second@example.test'}]})
 const form=coachPlayerFormFromPlayer(player);form.parentContacts=form.parentContacts.map((c,i)=>i?c:{...c,name:'Updated'})
 const payload=buildCoachPlayerPayload({context:user,form})
 assert.equal(payload.parent_contacts.length,2);assert.equal(payload.parent_contacts[1].email,'second@example.test')
 const empty=buildCoachPlayerPayload({context:user,form:{...form,parentContacts:[],parentEmail:'stale@example.test'}})
 assert.deepEqual(empty.parent_contacts,[]);assert.equal(empty.parent_email,'')
 assert.throws(()=>buildCoachPlayerPayload({context:user,form:{...form,parentContacts:[{email:'bad'}]}}),/valid/)
})
test('invite reuses pending link and sends only its authoritative id to server',async()=>{
 const db=client([{data:row},{data:[{id:'pending',status:'pending',email:'parent@example.test',expires_at:'2099-01-01'}]}]),sends=[]
 await (await parentApi(db,sends)).sendCoachParentInvite(user,'player',row.parent_contacts[0])
 assert.equal(db.calls.length,2);assert.deepEqual(JSON.parse(sends[0].options.body),{inviteLinkId:'pending'})
 assert.ok(db.calls[0].steps.some(s=>s[0]==='eq'&&s[1]==='team_id'&&s[2]==='team'))
 assert.ok(db.calls[1].steps.some(s=>s[0]==='eq'&&s[1]==='club_id'&&s[2]==='club'))
})
test('linked parent sends nothing, and unauthorized or unsaved contact cannot send',async()=>{
 const sends=[],api=await parentApi(client([{data:row},{data:[{id:'linked',status:'active',email:'parent@example.test'}]}]),sends)
 assert.deepEqual(await api.sendCoachParentInvite(user,'player',row.parent_contacts[0]),{alreadyLinked:true});assert.deepEqual(sends,[])
 await assert.rejects(()=>api.sendCoachParentInvite({...user,roleRank:0},'player',row.parent_contacts[0]),/Unauthorized/)
 await assert.rejects(()=>(parentApi(client([{data:row}]),sends).then(a=>a.sendCoachParentInvite(user,'player',{email:'other@example.test'}))),/Save this contact/)
})
test('expired pending invite is revoked before replacement and creation failure never sends',async()=>{
 const db=client([{data:row},{data:[{id:'old',email:'parent@example.test',status:'pending',expires_at:'2020-01-01'}]},{data:null},{error:Error('RLS denied')}]),sends=[]
 await assert.rejects(()=>(parentApi(db,sends).then(a=>a.sendCoachParentInvite(user,'player',row.parent_contacts[0]))),/RLS denied/)
 assert.equal(db.calls[2].steps[0][0],'update');assert.equal(db.calls[2].steps[0][1].status,'revoked');assert.deepEqual(sends,[])
})
test('access revocation is scoped to player, club, team and parent link',async()=>{
 const db=client([{data:row},{data:{id:'link'}}]);await(await parentApi(db)).revokeCoachParentAccess(user,'player','link')
 for(const [key,value]of [['player_id','player'],['club_id','club'],['team_id','team'],['id','link'],['link_type','parent']])assert.ok(db.calls[1].steps.some(s=>s[0]==='eq'&&s[1]===key&&s[2]===value))
})
test('match stats use exact counts, scoped completed squad selections, and preserve unknown scoring',async()=>{
 const db=client([{data:[]},{count:8,data:null}]);const api=await load('apps/mobile-core/src/coachPlayerStatsData.js',['getCoachPlayerStats'],{supabase:db,assertCoachOperationalRead:assertRead})
 const stats=await api.getCoachPlayerStats(user,'player');assert.equal(stats.matchdaySquad,8);assert.equal(stats.goals,null)
 const steps=db.calls.find(c=>c.table==='match_day_player_squad_decisions').steps
 assert.ok(steps.some(s=>s[0]==='select'&&s[2]?.count==='exact'&&s[2]?.head===true))
 assert.ok(steps.some(s=>s[0]==='eq'&&s[1]==='status'&&s[2]==='selected'))
 assert.ok(steps.some(s=>s[0]==='eq'&&s[1]==='match_days.team_id'&&s[2]==='team'))
 assert.ok(steps.some(s=>s[0]==='or'&&s[1].includes('full_time')))
})


test('first invite promotes the scoped uninvited row without creating a duplicate',async()=>{
 const db=client([{data:row},{data:[{id:'imported',status:'uninvited',email:'parent@example.test',expires_at:'2020-01-01'}]},{data:{id:'imported',status:'pending',email:'parent@example.test',expires_at:'2099-01-01'}}]),sends=[]
 await(await parentApi(db,sends)).sendCoachParentInvite(user,'player',row.parent_contacts[0])
 assert.equal(db.calls.length,3)
 const steps=db.calls[2].steps
 assert.equal(steps[0][0],'update');assert.equal(steps[0][1].status,'pending')
 assert.ok(Date.parse(steps[0][1].expires_at)>Date.now())
 for(const [key,value]of [['club_id','club'],['team_id','team'],['player_id','player'],['id','imported'],['link_type','parent'],['status','uninvited']])assert.ok(steps.some(s=>s[0]==='eq'&&s[1]===key&&s[2]===value))
 assert.equal(db.calls.some(call=>call.steps.some(s=>s[0]==='insert')),false)
 assert.deepEqual(JSON.parse(sends[0].options.body),{inviteLinkId:'imported'})
})

test('failed or raced uninvited promotion cannot send an invite',async()=>{
 for(const promotion of [{error:Error('Scoped update denied')},{data:null}]){
  const db=client([{data:row},{data:[{id:'imported',status:'uninvited',email:'parent@example.test'}]},promotion]),sends=[]
  await assert.rejects(()=>(parentApi(db,sends).then(api=>api.sendCoachParentInvite(user,'player',row.parent_contacts[0]))),/Scoped update denied|Parent invite changed/)
  assert.deepEqual(sends,[])
 }
})
