import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')

test('Coach multi-select removal uses an in-app confirmation modal', () => {
  assert.match(source, /const \[removalConfirmation, setRemovalConfirmation\] = useState\(null\)/)
  assert.ok(source.includes('<Modal animationType="fade" onRequestClose={() => setRemovalConfirmation(null)} transparent visible={Boolean(removalConfirmation)}>'))
  assert.match(source, /Remove \{removalConfirmation\?\.invites\.length \|\| 0\} Player/)
  assert.match(source, /label="Cancel" onPress=\{\(\) => setRemovalConfirmation\(null\)\}/)
  assert.match(source, /label="Remove from event"/)
  assert.match(source, /commitSelectedRemovals\(confirmation\.invites, confirmation\.requiresInProgressConfirmation\)/)
})

test('Coach removal is previewed before the confirmation modal opens', () => {
  const removalBlock = source.slice(source.indexOf('const removeSelected = async () => {'), source.indexOf('const createRequests = async () => {'))
  assert.match(removalBlock, /previewCoachInviteRemoval\(user, invite\)/)
  assert.match(removalBlock, /setRemovalConfirmation\(\{ invites, requiresInProgressConfirmation \}\)/)
  assert.doesNotMatch(removalBlock, /Alert\.alert/)
})
