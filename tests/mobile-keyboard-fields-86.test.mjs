import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createCoachScrollBounds } from '../apps/coach-mobile/src/coachScrollBounds.js'

const coachApp = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')

test('Coach form routes avoid the iOS and Android keyboards without double-adjusting insets', () => {
  assert.match(coachApp, /import \{[^}]*\bKeyboardAvoidingView,[^}]*\} from 'react-native'/)
  assert.match(coachApp, /<KeyboardAvoidingView[\s\S]*behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}[\s\S]*enabled=\{Platform\.OS === 'ios' \|\| Platform\.OS === 'android'\}[\s\S]*style=\{styles\.keyboardShell\}/)
  assert.match(coachApp, /<KeyboardAvoidingView[\s\S]*<ScrollView[\s\S]*<CoachRoute[\s\S]*<\/ScrollView>[\s\S]*<PrimaryNavigation[\s\S]*<CoachQuickActions[\s\S]*<\/KeyboardAvoidingView>/)
  assert.match(coachApp, /automaticallyAdjustKeyboardInsets=\{false\}/)
  assert.match(coachApp, /keyboardDismissMode=\{Platform\.OS === 'ios' \? 'interactive' : 'on-drag'\}/)
  assert.match(coachApp, /keyboardShouldPersistTaps="handled"/)
  assert.match(coachApp, /onScrollBeginDrag=\{\(event\) => \{\s*scrollBounds\.handlers\.onScrollBeginDrag\(event\)\s*Keyboard\.dismiss\(\)/)
  assert.match(coachApp, /keyboardShell: \{ flex: 1 \}/)
})

test('starting a drag dismisses the keyboard and keeps native gesture ownership', () => {
  const match = coachApp.match(/onScrollBeginDrag=\{\(event\) => \{([\s\S]*?)\n\s*\}\}/)
  assert.ok(match, 'The shared Coach scroller handles drag dismissal')
  const corrections = [], pending = new Map()
  let nextId = 0, dismissals = 0
  const bounds = createCoachScrollBounds(value => corrections.push(value), {
    setTimeout(callback) { pending.set(++nextId, callback); return nextId },
    clearTimeout(id) { pending.delete(id) },
  })
  const drag = new Function('scrollBounds', 'Keyboard', 'event', match[1])
  bounds.handlers.onLayout({ nativeEvent: { layout: { height: 480 } } })
  bounds.handlers.onContentSizeChange(390, 200)
  drag(bounds, { dismiss() { dismissals++ } }, { nativeEvent: {} })
  bounds.handlers.onScroll({ nativeEvent: { contentOffset: { y: 700 } } })
  for (const callback of pending.values()) callback()
  assert.equal(dismissals, 1)
  assert.deepEqual(corrections, [], 'Keyboard dismissal cannot force a scroll correction during a drag')
  bounds.dispose()
})

test('non-home Coach routes have no unrelated pull-to-refresh control', () => {
  assert.match(coachApp, /refreshControl=\{activeRoute === 'home' \? \([\s\S]*?onRefresh=\{\(\) => loadHome\(\{ refresh: true \}\)\}[\s\S]*?\) : undefined\}/)
  assert.match(coachApp, /alwaysBounceVertical=\{false\}/)
  assert.match(coachApp, /scrollToOverflowEnabled=\{false\}/)
})
