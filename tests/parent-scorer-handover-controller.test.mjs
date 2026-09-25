import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url),'utf8')
const handlerSource = app.slice(app.indexOf('  async function handleScorerAction('),app.indexOf('  async function handleDisplayThemeChange('))
const match = { id:'FP TEST match', isScorer:true, status:'full_time' }
const requestedAt = '2026-09-15T12:00:00Z'

for (const failure of ['none','notification','refresh','handover','delayed']) {
  test(`handover controller preserves ended access across ${failure} failure and rejects stale handlers`, async () => {
    let resources = {matches:{items:[match]}}
    const notices = []
    const selections = []
    const steps = []
    const locks = {current:{}}
    const scorerActionGenerationRef = { current: 0 }
    const scorerActionInFlightRef = { current: false }
    const parentActionScopeRef = { current: 0 }
    let currentNotice = null
    const context = {
      isOffline:false,activeActionId:'',selectedMobileUser:{id:'FP TEST parent'},scorerHandoversRef:locks,scorerActionGenerationRef,scorerActionInFlightRef,parentActionScopeRef,
      setActiveActionId: () => {},setNotice: value => { currentNotice = typeof value === 'function' ? value(currentNotice) : value; notices.push(currentNotice) },
      setSelectedMatchId: value => selections.push(value),
      setResources: updater => {resources=updater(resources);steps.push('controls removed')},
      requestParentScorerReview: async () => {steps.push('save');if(failure==='handover')throw new Error('Could not save');return{scorerReviewRequestedAt:requestedAt}},
      sendParentScorerMatchDayPush: async () => {assert.equal(resources.matches.items[0].isScorer,false);steps.push('notify');if(failure==='delayed')return new Promise(()=>{});return failure==='notification'?null:{success:true}},
      loadParentData: async () => {steps.push('refresh');if(failure==='delayed')return new Promise(()=>{});if(failure==='refresh')throw new Error('Refresh failed')},
      getParentFriendlyError: error => error.message,
      setParentScorerTimer: () => {throw new Error('A stale scorer mutation escaped the lock')},
    }
    vm.createContext(context)
    vm.runInContext(handlerSource,context)
    const pending=context.handleScorerAction(match,'request-review')
    assert.equal(await context.handleScorerAction(match,'request-review'),false)
    const result=await pending
    assert.equal(scorerActionInFlightRef.current,false)
    if(failure==='handover'){
      assert.equal(result.saved,false)
      assert.equal(resources.matches.items[0].isScorer,true)
      assert.deepEqual(steps,['save'])
      assert.deepEqual(selections,[])
    }else{
      assert.equal(result,true)
      assert.deepEqual(steps,['save','controls removed','refresh','notify'])
      assert.deepEqual(selections,[''])
      assert.equal(locks.current[match.id],requestedAt)
      assert.equal(await context.handleScorerAction(match,'timer','resume'),false)
      if (['notification','refresh'].includes(failure)) {
        assert.equal(notices.at(-1).tone,'warning')
        assert.match(notices.at(-1).message,/scoring access has ended/)
      } else {
        assert.equal(notices.at(-1),null)
      }
    }
  })
}
