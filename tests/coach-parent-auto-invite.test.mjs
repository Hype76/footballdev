import assert from 'node:assert/strict'
import test from 'node:test'
import { sendNewMatchdayParentInvites } from '../apps/mobile-core/src/coachParentAutoInvite.js'
const user={id:'coach',clubId:'club',activeTeamId:'team',role:'coach',roleRank:30,planKey:'matchday',hasActivePlanAccess:true,paymentAccess:{canMutate:true},matchdayPolicy:{flags:{players:true,parentPortal:true,parentInvitations:true}}}
const player={id:'player',section:'Squad',status:'active',parentContacts:[{email:' Parent@example.test ',type:'parent'},{email:'second@example.test',type:'parent'}]}
test('new Matchday contacts send once each, normalized, with confirmed status and per-contact failure recovery',async()=>{
 const sent=[],busy=[]
 const results=await sendNewMatchdayParentInvites({user,player:{...player,parentContacts:[...player.parentContacts,player.parentContacts[0]]},sendInvite:async(u,id,c)=>{sent.push([id,c.email]);if(c.email.startsWith('second'))throw Error('provider error')},onSending:e=>busy.push(e)})
 assert.deepEqual(sent,[['player','parent@example.test'],['player','second@example.test']])
 assert.equal(results['parent@example.test'].confirmedByServer,true)
 assert.equal(results['second@example.test'].status,'failed')
 assert.equal(busy.at(-1),'')
})
test('ordinary edits, existing contacts, adult contacts and other plans never automatically resend',async()=>{
 let sends=0;const sendInvite=async()=>{sends++}
 await sendNewMatchdayParentInvites({user,player,previousPlayer:player,sendInvite})
 await sendNewMatchdayParentInvites({user,player:{...player,parentContacts:[{email:'adult@example.test',type:'self'}]},sendInvite})
 for(const planKey of ['team','club','single_team','large_club'])await sendNewMatchdayParentInvites({user:{...user,planKey},player,sendInvite})
 assert.equal(sends,0)
 await sendNewMatchdayParentInvites({user,player,previousPlayer:{parentContacts:[player.parentContacts[0]]},sendInvite})
 assert.equal(sends,1)
})
test('disabled invites, denied role, missing team, archived player and inactive billing cannot auto send',async()=>{
 let sends=0;const sendInvite=async()=>{sends++}
 for(const patch of [{matchdayPolicy:{flags:{parentInvitations:false}}},{role:'parent_portal',roleRank:0},{activeTeamId:null},{hasActivePlanAccess:false,paymentAccess:{canMutate:false}}])await sendNewMatchdayParentInvites({user:{...user,...patch},player,sendInvite})
 await sendNewMatchdayParentInvites({user,player:{...player,status:'archived'},sendInvite})
 assert.equal(sends,0)
})
