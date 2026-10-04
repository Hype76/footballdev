import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import * as core from '../apps/mobile-core/src/parentNotificationsCore.js'
import { notificationPermissionState } from '../apps/parent-mobile/src/notificationExplainerCore.js'

const source=(await readFile(new URL('../apps/parent-mobile/src/notifications.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'').replace(/^export /gm,'')
function fixture({denied=false,blocked=false,tokenFail=false,apiFail=false,platform='android',quiet=false}={}) {
  const events=[],storage=new Map(),permission={status:'undetermined',granted:false,canAskAgain:!blocked,ios:{status:0}}
  let current=true
  const dep={ ...core,notificationPermissionState,
    AsyncStorage:{async getItem(key){return storage.get(key)??null},async setItem(key,value){storage.set(key,value)},async removeItem(key){storage.delete(key)}},
    SecureStore:{AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:1,async getItemAsync(key){return storage.get(key)??null},async setItemAsync(key,value){storage.set(key,value)},async deleteItemAsync(key){storage.delete(key)}},
    Application:{nativeApplicationVersion:'1.0.22',nativeBuildVersion:'1'},Crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},Device:{isDevice:true},Platform:{OS:platform},
    Notifications:{IosAuthorizationStatus:{AUTHORIZED:2,PROVISIONAL:3,EPHEMERAL:4},AndroidImportance:{HIGH:4,NONE:0},setNotificationHandler(){},
      async setNotificationCategoryAsync(){events.push('category')},async setNotificationChannelAsync(){await Promise.resolve();events.push('channel')},async getNotificationChannelAsync(){return {importance:4}},
      async getPermissionsAsync(){events.push('permission-read');return {...permission,ios:{...permission.ios}}},
      async requestPermissionsAsync(){events.push('OS-prompt');Object.assign(permission,{status:denied?'denied':'granted',granted:!denied,canAskAgain:!denied,ios:{status:denied?1:quiet?3:2}});return permission},
      async getDevicePushTokenAsync(){events.push('device-token');return {data:'mock'}},async getExpoPushTokenAsync(){events.push('expo-token');if(tokenFail)throw Error('invalid provider response');return {data:'ExpoPushToken[mock]'}},
    },
    async getAccessToken(){return 'mock-token'},joinApiPath:(base,p)=>base+p,
    async fetchJsonWithTimeout(url,options){events.push(options.method);if(apiFail&&options.method==='POST')return {ok:false,response:{status:500},result:{success:false,code:'PARENT_MOBILE_FAILED'}};return {ok:true,response:{status:200},result:{installation:{detailLevel:'minimal',registered:options.method==='POST',enabled:options.method==='POST'}}}},supabase:{},
  }
  const client=new Function(...Object.keys(dep),source+'\nreturn {enableParentNotifications,loadParentNotificationState};')(...Object.values(dep))
  return {client,events,permission,dep,storage,options:{apiBaseUrl:'https://test.example',parentLinkId:'mock-link',easProjectId:'mock-project',isCurrent:()=>current},cancel(){current=false}}
}
test('actual setup awaits Android channel before prompt/token and registers only once explicitly',async()=>{
  const f=fixture();const result=await f.client.enableParentNotifications(f.options)
  assert.equal(result.registered,true);assert.equal(result.visibleAlertsReady,true)
  assert.ok(f.events.indexOf('channel')<f.events.indexOf('OS-prompt'));assert.ok(f.events.indexOf('channel')<f.events.indexOf('device-token'))
  assert.equal(f.events.filter(x=>x==='POST').length,1)
})
test('actual Android OS dismissal does not PATCH a saved preference or register',async()=>{
  const f=fixture({denied:true});const result=await f.client.enableParentNotifications(f.options)
  assert.equal(result.permissionGranted,false);assert.equal(f.events.includes('PATCH'),false);assert.equal(f.events.includes('POST'),false)
})
test('blocked permission and token-refresh background flow never prompt the OS',async()=>{
  for(const blocked of [true,false]){
    const f=fixture({blocked});await f.client.enableParentNotifications({...f.options,requestPermission:false})
    assert.equal(f.events.includes('OS-prompt'),false);assert.equal(f.events.includes('POST'),false);assert.equal(f.events.includes('PATCH'),false)
  }
})
test('actual token and API failures remain unfinished and do not alter category/channel preferences',async()=>{
  for(const options of [{tokenFail:true},{apiFail:true}]){
    const f=fixture(options);await assert.rejects(f.client.enableParentNotifications(f.options))
    assert.equal(f.events.includes('PATCH'),false);assert.equal(f.events.filter(x=>x==='POST').length,options.apiFail?1:0)
  }
})
test('account cancellation while obtaining token prevents actual registration',async()=>{
  const f=fixture();f.dep.Notifications.getExpoPushTokenAsync=async()=>{f.cancel();return {data:'ExpoPushToken[mock]'}}
  await assert.rejects(f.client.enableParentNotifications(f.options));assert.equal(f.events.includes('POST'),false)
})
test('actual passive loader reads permission and installation without prompting or registration',async()=>{
  const f=fixture();await f.client.loadParentNotificationState(f.options)
  assert.equal(f.events.includes('OS-prompt'),false);assert.equal(f.events.includes('POST'),false);assert.equal(f.events.includes('PATCH'),false);assert.equal(f.events.includes('GET'),true)
})
test('actual explicit iOS setup retains quiet state instead of claiming visible alerts',async()=>{
  const f=fixture({platform:'ios',quiet:true});const result=await f.client.enableParentNotifications(f.options)
  assert.equal(result.permissionGranted,true);assert.equal(result.visibleAlertsReady,false);assert.equal(result.permissionStatus,'provisional')
})

test('actual loader detects blocking of the native default matchday channel', async()=>{
 const f=fixture();Object.assign(f.permission,{granted:true,status:'granted'});f.dep.Notifications.getNotificationChannelAsync=async id=>({importance:id==='matchday'?0:4});
 const state=await f.client.loadParentNotificationState(f.options);assert.equal(state.channelBlocked,true);assert.equal(state.visibleAlertsReady,false);assert.equal(state.permissionGranted,true)
})
