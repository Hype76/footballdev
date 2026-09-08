import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('downloaded OTA remains ready across resume checks and restarts only after an explicit action', async()=>{
 const source=await readFile('apps/mobile-core/src/updates.js','utf8')
 let state,check,checks=0,downloads=0,restarts=0,removed=0
 const effects=[], refs=[];let refIndex=0
 const context=vm.createContext({process:{env:{NODE_ENV:'production'}},Date,
 Updates:{isEnabled:true,checkForUpdateAsync:async()=>{checks++;return {isAvailable:checks===1}},fetchUpdateAsync:async()=>{downloads++},reloadAsync:async()=>{restarts++}},
 useState:initial=>{state??=initial;return[state,next=>{state=typeof next==='function'?next(state):next}]},
 useRef:initial=>refs[refIndex++]??(refs[refIndex-1]={current:initial}),useCallback:fn=>{check=fn;return fn},useEffect:fn=>effects.push(fn),
 AppState:{addEventListener:()=>({remove:()=>{removed++}})},setTimeout:()=>1,clearTimeout:()=>{}})
 vm.runInContext(source.replace(/^import .*$/gm,'').replace('export function','function'),context)
 let hook=context.useMobileAutomaticUpdates();const cleanup=effects[0]()
 assert.equal(restarts,0);await check();assert.equal(downloads,1);assert.equal(state.readyOnRestart,true)
 await check({force:true});assert.equal(checks,1);assert.equal(state.readyOnRestart,true)
 refIndex=0;hook=context.useMobileAutomaticUpdates();assert.equal(hook.readyOnRestart,true)
 assert.equal(restarts,0);await hook.restart();assert.equal(restarts,1);cleanup();assert.equal(removed,1)
})
