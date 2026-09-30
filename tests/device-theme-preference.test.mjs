import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeviceThemePreference } from '../apps/mobile-core/src/deviceThemePreferenceCore.js'
import { normalizeDeviceThemeMode, resolveDeviceThemeMode } from '../apps/mobile-core/src/deviceThemeCore.js'

for (const saved of [null, 'invalid', 'system', 'light', 'dark']) {
  test(`device preference restores ${saved} without overwriting storage`, async () => {
    const writes=[]
    const store=createDeviceThemePreference({read:async()=>saved,write:async value=>writes.push(value)})
    assert.equal(store.peek(),'system')
    assert.equal(await store.read(),normalizeDeviceThemeMode(saved))
    assert.deepEqual(writes,[])
    for(const systemMode of ['light','dark',null]) {
      assert.equal(resolveDeviceThemeMode(store.peek(),systemMode), ['light','dark'].includes(saved)?saved:systemMode==='dark'?'dark':'light')
    }
  })
}
test('all three preferences survive a new app instance after an update',async()=>{
  let saved=null
  const storage={read:async()=>saved,write:async value=>{saved=value}}
  for(const mode of ['light','dark','system']) {
    const old=createDeviceThemePreference(storage);await old.write(mode)
    const updated=createDeviceThemePreference(storage)
    assert.equal(await updated.read(),mode)
  }
})
test('late reads and rapid writes preserve the newest System selection',async()=>{
  let finishRead;let finishWrite;const writes=[]
  const store=createDeviceThemePreference({read:()=>new Promise(r=>finishRead=r),write:async value=>{if(value==='light')await new Promise(r=>finishWrite=r);writes.push(value)}})
  const loading=store.read();const first=store.write('light');await Promise.resolve();const last=store.write('system');finishRead('dark');assert.equal(await loading,'system');finishWrite();await Promise.all([first,last]);assert.deepEqual(writes,['light','system']);assert.equal(store.peek(),'system')
})
