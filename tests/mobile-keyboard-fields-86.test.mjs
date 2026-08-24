import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const coachApp = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')

test('Coach form routes avoid the iOS and Android keyboards without double-adjusting insets', () => {
  assert.match(coachApp, /Image,\s+KeyboardAvoidingView,\s+Linking,/)
  assert.match(coachApp, /<KeyboardAvoidingView[\s\S]*behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}[\s\S]*enabled=\{Platform\.OS === 'ios' \|\| Platform\.OS === 'android'\}[\s\S]*style=\{styles\.keyboardShell\}/)
  assert.match(coachApp, /<KeyboardAvoidingView[\s\S]*<Animated\.ScrollView[\s\S]*<CoachRoute[\s\S]*<\/Animated\.ScrollView>[\s\S]*<PrimaryNavigation[\s\S]*<CoachQuickActions[\s\S]*<\/KeyboardAvoidingView>/)
  assert.match(coachApp, /automaticallyAdjustKeyboardInsets=\{false\}/)
  assert.match(coachApp, /keyboardDismissMode=\{Platform\.OS === 'ios' \? 'interactive' : 'on-drag'\}/)
  assert.match(coachApp, /keyboardShouldPersistTaps="always"/)
  assert.match(coachApp, /keyboardShell: \{ flex: 1 \}/)
})
