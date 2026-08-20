import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260820090000_poll_multiple_choice_contract_75.sql', import.meta.url)
const parentExperienceUrl = new URL('../apps/parent-mobile/src/parentExperience.js', import.meta.url)
const parentOfflineUrl = new URL('../apps/parent-mobile/src/offline.js', import.meta.url)

test('Parent and Coach vote functions keep multiple choice separate from answer changes', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const functionName of ['submit_parent_portal_poll_vote', 'submit_staff_poll_vote']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${functionName}`))
  }

  const singleChoiceLocks = sql.match(/poll_row\.allow_multiple is false\s+and poll_row\.allow_vote_changes is false/g) || []
  assert.equal(singleChoiceLocks.length, 2)

  const multipleChoiceToggles = sql.match(/poll_row\.allow_multiple is true\s+and poll_row\.allow_vote_changes is true/g) || []
  assert.equal(multipleChoiceToggles.length, 2)
  assert.match(sql, /parent_poll_vote_limit_reached/)
  assert.match(sql, /poll_vote_limit_reached/)
})

test('Parent online and offline models preserve multiple saved answers', async () => {
  const [parentExperience, parentOffline] = await Promise.all([
    readFile(parentExperienceUrl, 'utf8'),
    readFile(parentOfflineUrl, 'utf8'),
  ])

  assert.match(parentExperience, /const currentOptionIds = Array\.isArray\(poll\.currentOptionIds\)/)
  assert.match(parentExperience, /if \(poll\.allowMultiple === true\)/)
  assert.match(parentExperience, /return poll\.allowVoteChanges === true/)
  assert.match(parentOffline, /activeCommands\.filter/)
  assert.match(parentOffline, /poll\.allowVoteChanges === true/)
})
