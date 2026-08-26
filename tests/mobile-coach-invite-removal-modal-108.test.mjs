import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')

test('Coach multi-select removal uses an in-app confirmation modal', () => {
  assert.match(source, /const \[removalConfirmation, setRemovalConfirmation\] = useState\(null\)/)
  assert.ok(source.includes('<Modal animationType="fade" onRequestClose={() => setRemovalConfirmation(null)} transparent visible={Boolean(removalConfirmation)}>'))
  assert.match(source, /Remove \{removalConfirmation\?\.invites\.length \|\| 0\} Player/)
  assert.match(source, /label="Cancel" onPress=\{\(\) => setRemovalConfirmation\(null\)\}/)
  assert.match(source, /'Remove from event'/)
  assert.match(source, /onPress=\{openRemovalConfirmation\}/)
  assert.match(source, /confirmSelectedRemoval\(\)/)
  assert.match(source, /commitSelectedRemovals\(invites, confirmation\.requiresInProgressConfirmation\)/)
})

test('Coach removal opens immediately and keeps preview failures inside the modal', () => {
  const removalBlock = source.slice(source.indexOf('const openRemovalConfirmation = () => {'), source.indexOf('const createRequests = async () => {'))
  const openBlock = removalBlock.slice(0, removalBlock.indexOf('const confirmSelectedRemoval = async () => {'))
  assert.match(openBlock, /setRemovalConfirmation\(\{ error: '', invites, previewed: false, requiresInProgressConfirmation: false \}\)/)
  assert.doesNotMatch(openBlock, /previewCoachInviteRemoval/)
  assert.match(removalBlock, /previewCoachInviteRemoval\(user, invite\)/)
  assert.match(removalBlock, /setRemovalConfirmation\(\(current\) => current \? \{ \.\.\.current, error \} : current\)/)
  assert.match(source, /removalConfirmation\?\.error/)
  assert.match(source, /Checking\.\.\./)
})
