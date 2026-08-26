import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getCoachChatModalTopInset } from '../apps/mobile-core/src/coachPhase31ECore.js'

const screen = await readFile(
  new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url),
  'utf8',
)

test('Coach chat modal protects its controls from system bars', () => {
  assert.match(screen, /import \{ SafeAreaView, useSafeAreaInsets \} from 'react-native-safe-area-context'/)
  assert.doesNotMatch(screen, /import \{[^\n]*SafeAreaView[^\n]*\} from 'react-native'/)
  assert.match(
    screen,
    /<SafeAreaView edges=\{\['right', 'bottom', 'left'\]\} style=\{styles\.chatModal\}>/,
  )
  assert.match(screen, /const safeAreaInsets = useSafeAreaInsets\(\)/)
  assert.match(screen, /paddingTop: chatModalTopInset \+ 14/)
  assert.match(screen, /<View style=\{styles\.chatComposer\}>[\s\S]*accessibilityLabel="Chat message"/)
})

test('Coach chat modal keeps its header below an iPhone status area', () => {
  assert.equal(getCoachChatModalTopInset({ platform: 'ios', safeAreaTop: 0 }), 44)
  assert.equal(getCoachChatModalTopInset({ platform: 'ios', safeAreaTop: 59 }), 59)
  assert.equal(getCoachChatModalTopInset({ platform: 'android', safeAreaTop: 24 }), 24)
})
