import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const actionSource = source.slice(source.indexOf('async function handleScorerAction'), source.indexOf('async function handleDisplayThemeChange'))
const names = ['isOffline','activeActionId','selectedMobileUser','setActiveActionId','setNotice','startParentScorerMatch','setParentScorerTimer','setParentScorerExtendedState','updateParentScorerScore','addParentScorerGoal','correctParentScorerGoal','voidParentScorerGoal','recordParentScorerShootoutKick','voidParentScorerShootoutKick','sendParentScorerMatchDayPush','loadParentData','getParentFriendlyError']
const makeAction = new Function(...names, `return (${actionSource.trim()})`)

test('Parent gameplay sends notifications only after saved changes, including all clock phases', async () => {
  for (const [action,value,status,expected] of [
    ['start',null,'live','live'], ['timer','half_time','half_time','half_time'],
    ['timer','resume','second_half','second_half'], ['timer','full_time','full_time','full_time'],
    ['extended','start_extra_time','extra_time','extra_time'], ['extended','start_penalties','penalties','penalties'],
    ['timer','pause','live',''], ['goal',{},'live','goal'], ['score',{homeScore:1,awayScore:0},'live','score_correction'],
  ]) {
    const calls = []
    const save = async () => { calls.push('saved'); return {id:'event-1',status} }
    const fn = makeAction(false,'',{id:'parent-1'},()=>{},()=>{},save,save,save,save,save,save,save,save,save,
      async (_user,_match,type,eventId) => { calls.push({type,eventId}); return {success:true} },
      async () => {}, (e) => e.message)
    assert.equal(await fn({id:'match-1',isScorer:true,status:'live'},action,value),true)
    assert.equal(calls[0],'saved')
    assert.deepEqual(calls.slice(1),expected ? [{type:expected,eventId:['goal','score_correction'].includes(expected)?'event-1':''}] : [])
  }
})

test('failed Parent saves send no success notification and keep the form open', async () => {
  const fail = async () => { throw new Error('Database rejected save') }
  let notified = false
  const fn = makeAction(false,'',{},()=>{},()=>{},fail,fail,fail,fail,fail,fail,fail,fail,fail,
    async () => { notified = true },async () => {},(e)=>e.message)
  assert.deepEqual(await fn({id:'match-1',isScorer:true},'goal',{}),{saved:false,message:'Database rejected save'})
  assert.equal(notified,false)
})
