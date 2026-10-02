import assert from 'node:assert/strict'
import test from 'node:test'
import { createNotificationExplainer, notificationPermissionState, notificationSetupChoice, notificationExplainerKey, respectsNotificationChoices } from '../apps/parent-mobile/src/notificationExplainerCore.js'
import { getMobileNotificationIndicator } from '../apps/mobile-core/src/deviceSettingsCore.js'
import { getParentNotificationStatusLabel } from '../apps/mobile-core/src/parentNotificationsCore.js'

const off = { permissionGranted: false, permissionStatus: 'undetermined', canAskAgain: true, registered: false, enabled: false, visibleAlertsReady: false }
function fixture({ state = off, saved = new Map(), key = 'parent-a-production', failLoad = false, failSetup = false, failSave = false, clock = 0 } = {}) {
  let data = { state: { ...state }, communication: { communicationChannel: 'both' }, categories: { gameDay: 'scores_cards', invites: true } }, snapshot
  const calls = { setup: 0, settings: 0 }
  const controller = createNotificationExplainer({ key,
    storage: { async getItem(k) { return saved.get(k) ?? null }, async setItem(k,v) { if(failSave) throw Error('disk'); saved.set(k,v) } },
    async load() { if (failLoad) throw Error('offline'); return data },
    async setup(isCurrent) { assert.equal(isCurrent(),true); calls.setup++; if(failSetup) throw Error('token/API'); return { ...off, permissionGranted: true, visibleAlertsReady: true, registered: true, enabled: true } },
    async openSettings() { calls.settings++ }, publish(value) { snapshot=value }, now:()=>clock,
  })
  return { controller,calls,saved,get snapshot(){return snapshot}, setData(value){data={...data,...value}}, advance(value){clock=value} }
}

test('Android requestable dismissal and blocked channel are distinct from permission', () => {
  for(const status of ['undetermined','denied']) assert.equal(notificationSetupChoice(notificationPermissionState({status,canAskAgain:true,granted:false},'android')), 'Turn on')
  assert.equal(notificationSetupChoice(notificationPermissionState({status:'denied',canAskAgain:false,granted:false},'android')), 'Open phone settings')
  const state={...notificationPermissionState({status:'granted',granted:true},'android',{importance:0}),registered:true,enabled:true}
  assert.equal(state.permissionGranted,true); assert.equal(state.visibleAlertsReady,false)
  assert.equal(notificationSetupChoice(state),'Open phone settings')
  assert.equal(getMobileNotificationIndicator(state,'ready').enabled,false)
  assert.match(getParentNotificationStatusLabel(state),/Visible alerts are off/)
})
test('iOS authorized, provisional, ephemeral and denied do not imply the same alert readiness', () => {
  for(const status of [2,3,4]) {
    const state={...notificationPermissionState({status:'granted',granted:true,ios:{status}},'ios'),registered:true,enabled:true}
    assert.equal(state.permissionGranted,true);assert.equal(state.visibleAlertsReady,status===2)
    if(status!==2) { assert.match(getParentNotificationStatusLabel(state),status===3?/quiet/i:/temporary/i);assert.equal(getMobileNotificationIndicator(state,'ready').enabled,false) }
  }
  const temporaryVisible = notificationPermissionState({status:'granted',ios:{status:4,allowsAlert:true}},'ios')
  assert.equal(temporaryVisible.visibleAlertsReady,true); assert.equal(temporaryVisible.quietDelivery,false)
  assert.equal(notificationPermissionState({granted:true,status:'denied',ios:{status:1},canAskAgain:false},'ios').permissionGranted,false)
  assert.equal(notificationPermissionState({status:'granted',ios:{status:2,allowsAlert:false}},'ios').visibleAlertsReady,false)
})
test('dismissal is local account/environment scoped and survives repeated mount/child changes', async () => {
  assert.notEqual(notificationExplainerKey('a','https://footballplayer.online'), notificationExplainerKey('b','https://footballplayer.online'))
  assert.notEqual(notificationExplainerKey('a','https://footballplayer.online'), notificationExplainerKey('a','https://test.example'))
  const f=fixture();await f.controller.refresh();assert.equal(f.snapshot.dismissed,false)
  await f.controller.dismiss();assert.deepEqual(f.calls,{setup:0,settings:0});f.controller.dispose()
  const returning=fixture({saved:f.saved});await returning.controller.refresh();assert.equal(returning.snapshot.dismissed,true)
  const other=fixture({saved:f.saved,key:'parent-b-production'});await other.controller.refresh();assert.equal(other.snapshot.dismissed,false)
  const phone=fixture();await phone.controller.refresh();assert.equal(phone.snapshot.dismissed,false)
})
test('Email-only, each relevant category opt-out and deliberate pause suppress setup', async () => {
  for(const patch of [{communication:{communicationChannel:'email'}},{categories:{gameDay:'off',invites:true}},{categories:{gameDay:'full',invites:false}},{state:{...off,registered:true,enabled:false}}]) {
    const f=fixture();f.setData(patch);await f.controller.act();assert.equal(f.snapshot.data.eligible,false);assert.deepEqual(f.calls,{setup:0,settings:0})
  }
  const f=fixture({saved:new Map([['parent-a-production.paused','1']])});await f.controller.act();assert.deepEqual(f.calls,{setup:0,settings:0})
  assert.equal(respectsNotificationChoices({state:off,communication:{communicationChannel:'app'},categories:{gameDay:'scores_cards',invites:true,chats:false,resources:false}}),false)
})
test('fresh explicit action saves dismissal before setup, without background setup', async () => {
  const f=fixture();await f.controller.refresh();await f.controller.appState('active');assert.equal(f.calls.setup,0)
  await f.controller.act();assert.equal(f.calls.setup,1);assert.equal(f.snapshot.dismissed,true)
})
test('blocked permission opens supported settings and only this current flow finishes on return', async () => {
  const f=fixture({state:{...off,permissionStatus:'denied',canAskAgain:false}});await f.controller.act();assert.equal(f.calls.settings,1);assert.equal(f.calls.setup,0)
  await f.controller.appState('background');f.setData({state:{...off,permissionGranted:true,visibleAlertsReady:true}})
  await f.controller.appState('active');assert.equal(f.calls.setup,1)
  await f.controller.appState('active');assert.equal(f.calls.setup,1)
})
test('ordinary Settings return, expired flow and unchanged permission never register', async () => {
  for(const kind of ['ordinary','expired','denied','quiet','blocked-channel']) {
    const f=fixture({state:{...off,permissionStatus:'denied',canAskAgain:false}})
    if(kind!=='ordinary')await f.controller.act()
    await f.controller.appState('background')
    if(kind==='expired')f.advance(120001)
    if(kind!=='denied')f.setData({state:{...off,permissionGranted:true,visibleAlertsReady:!['quiet','blocked-channel'].includes(kind)}})
    await f.controller.appState('active');assert.equal(f.calls.setup,0,kind)
  }
})
test('account/child disposal cancels outstanding setup and callbacks', async () => {
  const f=fixture({state:{...off,permissionStatus:'denied',canAskAgain:false}});await f.controller.act();f.controller.dispose()
  f.setData({state:{...off,permissionGranted:true,visibleAlertsReady:true}});await f.controller.appState('active');assert.equal(f.calls.setup,0)
})
test('offline or failed preference read, failed dismissal write, token/API failure fail closed', async () => {
  for(const option of [{failLoad:true},{failSave:true},{failSetup:true}]) {
    const f=fixture(option);await f.controller.act();assert.ok(f.snapshot.error)
    assert.equal(f.calls.settings,0);assert.equal(f.calls.setup,option.failSetup?1:0)
  }
})
test('new opt-out while in phone settings prevents registration', async () => {
  const f=fixture({state:{...off,permissionStatus:'denied',canAskAgain:false}});await f.controller.act();await f.controller.appState('background')
  f.setData({communication:{communicationChannel:'email'},state:{...off,permissionGranted:true,visibleAlertsReady:true}})
  await f.controller.appState('active');assert.equal(f.calls.setup,0)
})
test('permission on with missing registration offers Finish setup', () => {
  assert.equal(notificationSetupChoice({...off,permissionGranted:true,visibleAlertsReady:true}),'Finish setup')
})

test('an observed installation pause remains suppressed after normal logout clears server binding', async () => {
  const paused=fixture({state:{...off,registered:true,enabled:false}});await paused.controller.refresh();paused.controller.dispose();
  const login=fixture({saved:paused.saved});await login.controller.act();assert.equal(login.snapshot.data.eligible,false);assert.equal(login.calls.setup,0)
})

test('Settings return restores permission without registering an already active installation', async()=>{
 const f=fixture({state:{...off,registered:true,enabled:true,permissionStatus:'denied',canAskAgain:false}});await f.controller.act();await f.controller.appState('background');
 f.setData({state:{...off,registered:true,enabled:true,permissionGranted:true,visibleAlertsReady:true}});await f.controller.appState('active');assert.equal(f.calls.setup,0)
})

test('iOS authorized permission with alerts disabled is distinct from provisional quiet delivery',()=>{
 const state={...notificationPermissionState({status:'granted',ios:{status:2,allowsAlert:false}},'ios'),registered:true,enabled:true};
 assert.equal(state.permissionGranted,true);assert.equal(state.quietDelivery,false);assert.equal(state.visibleAlertsReady,false);
 assert.match(getParentNotificationStatusLabel(state),/Visible alerts are off/);assert.equal(notificationSetupChoice(state),'Open phone settings')
})
