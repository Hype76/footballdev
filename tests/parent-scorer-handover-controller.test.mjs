import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url),'utf8')
const handlerSource = app.slice(app.indexOf('  async function handleScorerAction('),app.indexOf('  async function handleDisplayThemeChange('))
const match = { id:'FP TEST match', isScorer:true, status:'full_time' }
const requestedAt = '2026-09-15T12:00:00Z'

for (const failure of ['none','notification','refresh','handover']) {
  test(`handover controller preserves ended access across ${failure} failure and rejects stale handlers`, async () => {
    let resources = {matches:{items:[match]}}
    const notices = []
    const steps = []
    const locks = {current:{}}
    const context = {
      isOffline:false,activeActionId:'',selectedMobileUser:{id:'FP TEST parent'},scorerHandoversRef:locks,
      setActiveActionId: () => {},setNotice: value => notices.push(value),
      setResources: updater => {resources=updater(resources);steps.push('controls removed')},
      requestParentScorerReview: async () => {steps.push('save');if(failure==='handover')throw new Error('Could not save');return{scorerReviewRequestedAt:requestedAt}},
      sendParentScorerMatchDayPush: async () => {assert.equal(resources.matches.items[0].isScorer,false);steps.push('notify');return failure==='notification'?null:{success:true}},
      loadParentData: async () => {steps.push('refresh');if(failure==='refresh')throw new Error('Refresh failed')},
      getParentFriendlyError: error => error.message,
      setParentScorerTimer: () => {throw new Error('A stale scorer mutation escaped the lock')},
    }
    vm.createContext(context)
    vm.runInContext(handlerSource,context)
    const result=await context.handleScorerAction(match,'request-review')
    if(failure==='handover'){
      assert.equal(result.saved,false)
      assert.equal(resources.matches.items[0].isScorer,true)
      assert.deepEqual(steps,['save'])
    }else{
      assert.equal(result,true)
      assert.deepEqual(steps,['save','controls removed','notify','refresh'])
      assert.equal(locks.current[match.id],requestedAt)
      assert.equal(await context.handleScorerAction(match,'timer','resume'),false)
      assert.equal(notices.at(-1).tone,failure==='none'?'success':'warning')
      assert.match(notices.at(-1).message,/scoring access has ended/)
    }
  })
}
