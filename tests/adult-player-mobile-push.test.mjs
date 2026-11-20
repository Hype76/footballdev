import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { adultPlayerNotificationScope, resolveAdultPlayerNotificationOpen } from '../apps/parent-mobile/src/adultPlayerNotificationsCore.js'
import { processAdultPlayerMobilePush } from '../netlify/functions/process-adult-player-mobile-push.js'

const link = { id: 'own-link', clubId: 'own-club', teamId: 'own-team' }
const data = { app: 'player', adultLinkId: link.id, clubId: link.clubId, teamId: link.teamId, route: 'chat', roomId: 'own-room' }
test('Player taps require exact active link, team and club, then an authoritative target', () => {
 assert.deepEqual(resolveAdultPlayerNotificationOpen(data,link,{chatRooms:[{id:'own-room'}]}),{tab:'chat',targetId:'own-room'})
 assert.deepEqual(resolveAdultPlayerNotificationOpen(data,link,{chatRooms:[{id:'foreign-room'}]}),{tab:'chat',targetId:''})
 for(const change of [{app:'parent'},{adultLinkId:'other'},{clubId:'other'},{teamId:'other'},{route:'messages'}]) assert.equal(resolveAdultPlayerNotificationOpen({...data,...change},link),null)
 assert.notEqual(adultPlayerNotificationScope('user',link),adultPlayerNotificationScope('other',link))
 assert.notEqual(adultPlayerNotificationScope('user',link),adultPlayerNotificationScope('user',{...link,id:'other'}))
 assert.deepEqual(resolveAdultPlayerNotificationOpen({...data,route:'invites',invitationId:'match:own'},link,{invitations:[{invitationId:'match:own'}]}),{tab:'invites',targetId:'match:own'})
})

test('Player worker records success, retries transient failures, revokes invalid token without logging content', async () => {
 const updates=[]
 const intents=[1,2,3].map(id=>({intent_id:id,installation_id:`device-${id}`,payload:{to:`ExpoPushToken[token${id}]`,data:{app:'player'}}}))
 const client={async rpc(name,args){assert.equal(name,'claim_adult_player_mobile_push_intents');assert.equal(args.batch_size_value,10);return {data:intents}},from(table){return {update(values){const row={table,values,filters:[]};updates.push(row);return {eq(column,value){row.filters.push([column,value]);return this},then(resolve){resolve({error:null})}}}}}}
 const result=await processAdultPlayerMobilePush({client,async sendMessages([payload]){if(payload.to.includes('token2'))throw new Error('network');if(payload.to.includes('token3'))return {sent:0,failed:1,invalidTokens:[payload.to]};return {sent:1,failed:0}}})
 assert.deepEqual(result,{claimed:3,sent:1,failed:2})
 assert.equal(updates.filter(row=>row.table==='adult_player_mobile_push_intents'&&row.values.status==='failed').length,2)
 const revoked=updates.find(row=>row.table==='adult_player_mobile_push_installations')
 assert.equal(revoked.values.enabled,false);assert.equal(revoked.values.expo_push_token,null)
 assert.deepEqual(revoked.filters,[['installation_id','device-3'],['expo_push_token','ExpoPushToken[token3]']])
})

test('Player app tap refresh is fenced against account/link changes and sign-out unbinds both identities',async()=>{
 const app=await readFile(new URL('../apps/parent-mobile/App.js',import.meta.url),'utf8')
 const client=await readFile(new URL('../apps/parent-mobile/src/notifications.js',import.meta.url),'utf8')
 assert.match(app,/currentAccountRef.current !== user\?\.id \|\| playerPushScopeRef.current !== expectedScope \|\| result\?\.stale/)
 assert.match(app,/notificationResponseHistoryRef.current.has\(responseId\)/)
 assert.match(client,/action_value: 'delete', installation_id_value: installationId/)
 assert.doesNotMatch(app,/Player device push alerts are not available/)
})

test('Player notification initialization uses existing Expo capability without newer native invitation actions',async()=>{
 const source=await readFile(new URL('../apps/parent-mobile/src/notifications.js',import.meta.url),'utf8')
 const body=source.slice(source.indexOf('export async function initializeParentNotifications('),source.indexOf('export function addParentPushTokenListener(')).replace('export ','')
 let categoryCalls=0
 const initialize=new Function('registerBackgroundInvitationActions','Notifications','Platform','CHANNEL_ID',`${body};return initializeParentNotifications`)(async()=>{throw new Error('new native actions unavailable')},{async setNotificationCategoryAsync(){categoryCalls++}},{OS:'ios'},'parent-updates')
 await initialize({adultPlayer:true})
 assert.equal(categoryCalls,0)
 await assert.rejects(initialize(),/new native actions unavailable/)
})
