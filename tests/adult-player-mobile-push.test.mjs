import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { adultPlayerNotificationScope, resolveAdultPlayerNotificationOpen, prepareAdultPlayerNotificationMode, openAdultPlayerNotification } from '../apps/parent-mobile/src/adultPlayerNotificationsCore.js'
import { processAdultPlayerMobilePush } from '../netlify/functions/process-adult-player-mobile-push.js'
import { sendAdultPlayerShootoutNotifications } from '../netlify/functions/lib/_adult-player-matchday-push.js'

test('Adult Player shootout delivery verifies current installation, scope and kick checkpoint', async () => {
 const target={installation_id:'device',user_id:'adult',adult_link_id:'verified',club_id:'club',team_id:'team',expo_push_token:'ExpoPushToken[adult]',detail_level:'minimal'}
 const revoked={...target,installation_id:'revoked',user_id:'former',expo_push_token:'ExpoPushToken[former]'}
 const delivered=new Set(),messages=[]
 const client={async rpc(name,args){assert.equal(name,'get_shootout_adult_player_notification_targets');assert.equal(args.match_day_id_value,'game');return {data:args.installation_id_value===null?[target,revoked]:args.installation_id_value==='device'?[target]:[]}}}
 const checkpoint={has:key=>delivered.has(key),save:async key=>delivered.add(key)}
 const sendMessages=async payload=>{messages.push(...payload);return {sent:1,failed:0}}
 const copy={notificationType:'shootout_kick',title:'Penalty scored',minimalBody:'Shootout: 1 - 0.',detailedBody:'Shootout: 1 - 0.',tag:'kick'}
 const args={client,match:{id:'game'},notificationCopy:copy,eventId:'kick',checkpoint,sendMessages}
 assert.deepEqual(await sendAdultPlayerShootoutNotifications(args),{adultPlayerSent:1,adultPlayerFailed:0})
 assert.equal(messages.length,1)
 assert.deepEqual(messages[0].data,{app:'player',route:'matchday',type:'shootout_kick',eventId:'kick',matchDayId:'game',userId:'adult',adultLinkId:'verified',clubId:'club',teamId:'team'})
 assert.equal(messages[0].body,'Shootout: 1 - 0.')
 assert.equal(await sendAdultPlayerShootoutNotifications(args).then(result=>result.adultPlayerSent),0)
 for (const [type,title] of [['penalties','Penalty shootout started'],['full_time','Penalty shootout finished']]) {
  assert.equal((await sendAdultPlayerShootoutNotifications({...args,checkpoint:null,notificationCopy:{...copy,notificationType:type,title}})).adultPlayerSent,1)
 }
 assert.equal((await sendAdultPlayerShootoutNotifications({...args,checkpoint:null,notificationCopy:{...copy,notificationType:'goal'}})).adultPlayerSent,0)
 assert.equal(messages.length,3)
})

const link = { id: 'own-link', clubId: 'own-club', teamId: 'own-team' }
const data = { app: 'player', userId: 'user', adultLinkId: link.id, clubId: link.clubId, teamId: link.teamId, route: 'chat', roomId: 'own-room' }
test('Player taps require exact active link, team and club, then an authoritative target', () => {
 assert.deepEqual(resolveAdultPlayerNotificationOpen(data,link,{chatRooms:[{id:'own-room'}]}),{tab:'chat',targetId:'own-room'})
 assert.deepEqual(resolveAdultPlayerNotificationOpen(data,link,{chatRooms:[{id:'foreign-room'}]}),{tab:'chat',targetId:''})
 for(const change of [{app:'parent'},{adultLinkId:'other'},{clubId:'other'},{teamId:'other'},{route:'messages'}]) assert.equal(resolveAdultPlayerNotificationOpen({...data,...change},link),null)
 assert.notEqual(adultPlayerNotificationScope('user',link),adultPlayerNotificationScope('other',link))
 assert.notEqual(adultPlayerNotificationScope('user',link),adultPlayerNotificationScope('user',{...link,id:'other'}))
 assert.deepEqual(resolveAdultPlayerNotificationOpen({...data,route:'invites',invitationId:'match:own'},link,{invitations:[{invitationId:'match:own'}]}),{tab:'invites',targetId:'match:own'})
 assert.deepEqual(resolveAdultPlayerNotificationOpen({...data,route:'matchday',matchDayId:'match:own'},link,{matches:[{id:'match:own'}]}),{tab:'matchday',targetId:'match:own'})
 assert.deepEqual(resolveAdultPlayerNotificationOpen({...data,route:'matchday',matchDayId:'match:other'},link,{matches:[{id:'match:own'}]}),{tab:'matchday',targetId:''})
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
 assert.match(app,/currentAccountRef.current === user\?\.id && playerPushScopeRef.current === expectedScope/)
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

test('shared app switches the same authenticated Parent into the freshly authorised Player mode',async()=>{
 let mode='parent';const rejected=[];let checks=0
 const run=()=>prepareAdultPlayerNotificationMode({data,userId:'user',refresh:async()=>{checks++;return {status:'linked',link}},isCurrent:()=>true,selectPlayer:()=>{mode='player'},reject:()=>rejected.push('rejected')})
 assert.equal(await run(),'player');assert.equal(mode,'player');assert.equal(checks,1);assert.deepEqual(rejected,[])
 mode='parent'
 assert.equal(await prepareAdultPlayerNotificationMode({data,userId:'wrong-user',refresh:async()=>assert.fail('Wrong account must not fetch Player access'),isCurrent:()=>true,selectPlayer:()=>assert.fail('Wrong account must not switch'),reject:()=>rejected.push('wrong-account')}),'reject')
 assert.equal(mode,'parent')
 assert.equal(await prepareAdultPlayerNotificationMode({data,userId:'user',refresh:async()=>({status:'linked',link:{...link,id:'previous-or-foreign'}}),isCurrent:()=>true,selectPlayer:()=>assert.fail('Stale link must not switch'),reject:()=>rejected.push('stale-link')}),'reject')
 assert.deepEqual(rejected,['wrong-account','stale-link'])
 assert.equal(await prepareAdultPlayerNotificationMode({data,userId:'user',refresh:async()=>({status:'linked',link}),isCurrent:()=>false,selectPlayer:()=>assert.fail('Changed account must not switch'),reject:()=>assert.fail('Changed account must not consume newer response')}),'stale')
})

test('a transient access or target refresh failure keeps the tap pending until successful current navigation',async()=>{
 let consumed=0;let navigated=0;let mode='parent'
 const route={data,userId:'user',isCurrent:()=>true,selectPlayer:()=>{mode='player'},reject:()=>consumed++}
 assert.equal(await prepareAdultPlayerNotificationMode({...route,refresh:async()=>({status:'error'})}),'retry')
 assert.equal(mode,'parent');assert.equal(consumed,0)
 assert.equal(await prepareAdultPlayerNotificationMode({...route,refresh:async()=>({status:'linked',link})}),'player')
 const open={data,link,userId:'user',isCurrent:()=>true,navigate:()=>{navigated++;assert.equal(consumed,0)},consume:()=>consumed++}
 assert.equal(await openAdultPlayerNotification({...open,load:async()=>{throw new Error('offline')}}),'retry')
 assert.equal(await openAdultPlayerNotification({...open,load:async()=>({failed:1,items:{}})}),'retry')
 assert.equal(consumed,0);assert.equal(navigated,0)
 assert.equal(await openAdultPlayerNotification({...open,load:async()=>({failed:0,items:{chatRooms:[{id:'own-room'}]}})}),'opened')
 assert.equal(consumed,1);assert.equal(navigated,1)
 assert.equal(await openAdultPlayerNotification({...open,isCurrent:()=>false,load:async()=>({failed:0,items:{chatRooms:[{id:'own-room'}]}})}),'stale')
 assert.equal(consumed,1);assert.equal(navigated,1)
})

test('shared app sign-out invokes both authenticated role revocations before native unregister',async()=>{
 const source=await readFile(new URL('../apps/parent-mobile/src/notifications.js',import.meta.url),'utf8')
 const body=source.slice(source.indexOf('export async function unbindParentNotifications('),source.indexOf('export async function sendParentTestNotification(')).replace('export ','')
 const steps=[]
 const run=new Function('getInstallationId','fetchJsonWithTimeout','joinApiPath','getInstallationPath','supabase','Notifications',`${body};return unbindParentNotifications`)(async()=> 'device',async(url,options)=>{assert.equal(options.method,'DELETE');assert.equal(options.headers.Authorization,'Bearer current-session');steps.push('parent');return {ok:true,result:{success:true}}},()=>'/parent',()=>'/parent',{async rpc(name,args){assert.equal(name,'own_adult_player_push_installation');assert.equal(args.action_value,'delete');assert.equal(args.installation_id_value,'device');steps.push('player');return {error:null}}},{async unregisterForNotificationsAsync(){steps.push('native')},async setBadgeCountAsync(){}})
 await run({accessToken:'current-session',apiBaseUrl:'https://example.test'})
 assert.deepEqual(steps,['parent','player','native'])
})
