import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { summarizeCoachPoll } from '../apps/mobile-core/src/coachPhase31ECore.js'
import {
  getParentSyncSummary,
  reconcileParentSyncAttention,
} from '../apps/mobile-core/src/parentOfflineCore.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('Coach Poll results rank the highest vote total first and keep source order for ties', () => {
  const result = summarizeCoachPoll({
    options: [
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two' },
      { id: 'three', label: 'Three' },
    ],
    votes: [
      { optionId: 'two' },
      { optionId: 'two' },
      { optionId: 'one' },
      { optionId: 'three' },
    ],
  })

  assert.deepEqual(result.map((option) => [option.id, option.count, option.rank]), [
    ['two', 2, 1],
    ['one', 1, 2],
    ['three', 1, 3],
  ])
})

test('Parent attention clears a closed Poll and a response already confirmed by the server', () => {
  const base = {
    journal: [{
      childScope: 'link-1',
      commandId: 'command-1',
      createdAt: '2026-08-17T10:00:00.000Z',
      entityId: 'poll-1',
      localSequence: 1,
      payload: { optionId: 'yes' },
      status: 'conflict',
      type: 'poll_vote',
    }],
  }
  const closed = reconcileParentSyncAttention(base, {
    childScope: 'link-1',
    now: () => Date.parse('2026-08-17T12:00:00.000Z'),
    polls: [{ id: 'poll-1', status: 'closed' }],
  })
  const confirmed = reconcileParentSyncAttention(base, {
    childScope: 'link-1',
    now: () => Date.parse('2026-08-17T12:00:00.000Z'),
    polls: [{ id: 'poll-1', status: 'open', currentOptionIds: ['yes'] }],
  })

  assert.equal(getParentSyncSummary(closed, 'link-1').needsAttention, 0)
  assert.equal(getParentSyncSummary(confirmed, 'link-1').needsAttention, 0)
  assert.equal(confirmed.journal[0].lastErrorCategory, 'server_state_confirmed')
})

test('Coach mobile keeps creation hidden until requested and expands one fixture or Poll at a time', async () => {
  const screen = await read('../apps/coach-mobile/src/CoachPhase31EScreens.js')

  assert.match(screen, /createFormOpen \? <View style=\{styles\.panel\}>/)
  assert.match(screen, /expanded \? 'Hide results' : 'View results'/)
  assert.match(screen, /Choose an upcoming fixture to see its availability\./)
  assert.match(screen, /expanded \? 'Hide availability' : 'Open availability'/)
  assert.match(screen, /Create availability requests/)
  assert.doesNotMatch(screen, /\{\(data\.all \|\| \[\]\)\.length \? data\.all\.map/)
})

test('Coach home omits decorative lifetime counts and Development finalisation shares an authorised snapshot', async () => {
  const app = await read('../apps/coach-mobile/App.js')
  const screens = await read('../apps/coach-mobile/src/CoachPhase31EScreens.js')
  const data = await read('../apps/mobile-core/src/coachPhase31EData.js')

  assert.doesNotMatch(app, /<StatCard label="Players"/)
  assert.doesNotMatch(app, /<StatCard label="Matches"/)
  assert.match(screens, /Finalise and share/)
  assert.match(data, /resolve_development_recipients/)
  assert.match(data, /finalize_development_parent_report/)
})

test('Player of the Match migration uses only the selected fixture squad', async () => {
  const migration = await read('../supabase/migrations/20260817162951_match_day_motm_selected_squad_only.sql')

  assert.match(migration, /from public\.match_day_player_squad_decisions decision/)
  assert.match(migration, /decision\.status = 'selected'/)
  assert.match(migration, /player\.section = 'Squad'/)
  assert.match(migration, /revoke all on function public\.create_match_day_motm_poll\(uuid\)/)
})

test('corrective 65 is authorised for both production builds and submissions', async () => {
  const [buildGuard, submitGuard] = await Promise.all([
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-COMPACTION-ATTENTION-65/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-COMPACTION-ATTENTION-65/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-COMPACTION-ATTENTION-65'/)
})
