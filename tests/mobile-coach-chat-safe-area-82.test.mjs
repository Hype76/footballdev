import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const screen = await readFile(
  new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url),
  'utf8',
)

test('Coach chat modal protects the composer from Android system navigation', () => {
  assert.match(screen, /import \{ SafeAreaView \} from 'react-native-safe-area-context'/)
  assert.doesNotMatch(screen, /import \{[^\n]*SafeAreaView[^\n]*\} from 'react-native'/)
  assert.match(
    screen,
    /<SafeAreaView edges=\{\['top', 'right', 'bottom', 'left'\]\} style=\{styles\.chatModal\}>/,
  )
  assert.match(screen, /<View style=\{styles\.chatComposer\}>[\s\S]*accessibilityLabel="Chat message"/)
})
