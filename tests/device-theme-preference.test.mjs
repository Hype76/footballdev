import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeviceThemePreference } from '../apps/mobile-core/src/deviceThemePreferenceCore.js'
import { getDeviceThemeStorageKey, normalizeDeviceThemeMode, resolveDeviceThemeMode } from '../apps/mobile-core/src/deviceThemeCore.js'

for (const saved of [null, 'invalid', 'system', 'light', 'dark']) {
  test(`device preference restores ${saved} without overwriting storage`, async () => {
    const writes=[]
    const store=createDeviceThemePreference({read:async()=>saved,write:async value=>writes.push(value)})
    assert.equal(store.peek(),'light')
    assert.equal(await store.read(),normalizeDeviceThemeMode(saved))
    assert.deepEqual(writes,[])
    for(const systemMode of ['light','dark',null]) {
      assert.equal(resolveDeviceThemeMode(store.peek(),systemMode), saved === 'system' ? systemMode === 'dark' ? 'dark' : 'light' : ['light','dark'].includes(saved) ? saved : 'light')
    }
  })
}

test('old dark and System preferences reset once, then explicit choices survive future updates', async () => {
  const stored = new Map([['fp.mobile.local.v1.coach.theme', 'dark'], ['fp.parent.display-theme.v1', 'system']])
  for (const role of ['coach', 'parent']) {
    const key = getDeviceThemeStorageKey(role)
    const storage = { read: async () => stored.get(key), write: async mode => { stored.set(key, mode) } }
    const first = createDeviceThemePreference(storage)
    assert.equal(first.peek(), 'light')
    assert.equal(await first.read(), 'light')
    assert.equal(resolveDeviceThemeMode(first.peek(), 'dark'), 'light')
    await first.write('dark')
    assert.equal(await createDeviceThemePreference(storage).read(), 'dark')
    await first.write('system')
    assert.equal(await createDeviceThemePreference(storage).read(), 'system')
  }
})
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
