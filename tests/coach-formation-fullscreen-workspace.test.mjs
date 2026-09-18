import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('Coach Formation workspace is a safe fixed full-screen canvas', async () => {
  const source = await read('../apps/coach-mobile/src/CoachFormationWorkspace.js')

  assert.match(source, /<Modal[\s\S]*presentationStyle="fullScreen"/)
  assert.match(source, /onRequestClose=\{handleBack\}/)
  assert.match(source, /accessibilityViewIsModal/)
  assert.match(source, /edges=\{\['top', 'right', 'bottom', 'left'\]\}/)
  assert.match(source, /testID="coach-formation-workspace"/)
  assert.match(source, /testID="coach-formation-workspace-canvas"/)
  assert.doesNotMatch(source, /coach-formation-workspace-scroll/)
  assert.doesNotMatch(source, /<ScrollView/)
  assert.match(source, /onMarkerGestureStart: handleMarkerGestureStart/)
  assert.match(source, /onMarkerGestureEnd: handleMarkerGestureEnd/)
  assert.match(source, /registerBackHandler/)
  assert.match(source, /if \(backHandler\) await backHandler\(\)[\s\S]*else await onBack\?\.\(\)/)
  assert.match(source, /<SafeAreaProvider>[\s\S]*<SafeAreaView/)
  assert.match(source, /accessibilityLabel="Close Formation Board"[\s\S]*testID="coach-formation-workspace-canvas"/)
  assert.match(source, /if \(leaving.current\) return[\s\S]*finally \{ leaving.current = false \}/)
  assert.doesNotMatch(source, /PrimaryNavigation|CoachQuickActions|CoachHeader|ContextSwitcher/)
})

test('standalone Formation route preserves its prior route and hides app chrome behind the workspace', async () => {
  const source = await read('../apps/coach-mobile/App.js')

  assert.match(source, /import \{ CoachFormationWorkspace \}/)
  assert.match(source, /routeTarget\.activeRoute === 'formation'[\s\S]*formationReturnRef\.current = \{ activeRoute, moreRoute \}/)
  assert.match(source, /const closeFormationWorkspace = useCallback[\s\S]*navigate\(target\.moreRoute \|\| target\.activeRoute \|\| 'home'\)/)
  assert.match(source, /activeRoute === 'formation'[\s\S]*<CoachFormationWorkspace initialPitchVisible=\{false\} onBack=\{props\.onFormationBack\}/)
  assert.match(source, /<CoachFormationScreen[\s\S]*onBack=\{props\.onFormationBack\}[\s\S]*registerBackHandler=\{registerBackHandler\}/)
})

test('Match Day Formation opens the same full-screen workspace and returns to its prior panel', async () => {
  const source = await read('../apps/coach-mobile/src/CoachMatchDayScreen.js')

  assert.match(source, /import \{ CoachFormationWorkspace \}/)
  assert.match(source, /formationReturnPanelRef = useRef\('overview'\)/)
  assert.match(source, /nextPanel === 'formation'[\s\S]*formationReturnPanelRef\.current = panel/)
  assert.match(source, /closeFormationWorkspace = useCallback\(\(\) => setPanel\(formationReturnPanelRef\.current \|\| 'overview'\)/)
  assert.match(source, /panel === 'formation'[\s\S]*<CoachFormationWorkspace onBack=\{closeFormationWorkspace\}/)
  assert.match(source, /<CoachFormationBoard[\s\S]*onBack=\{closeFormationWorkspace\}[\s\S]*onMarkerGestureEnd=\{onMarkerGestureEnd\}[\s\S]*onMarkerGestureStart=\{onMarkerGestureStart\}[\s\S]*registerBackHandler=\{registerBackHandler\}/)
})

test('Coach Formation screen and board forward Back, draft flush, and gesture ownership', async () => {
  const [screen, board] = await Promise.all([
    read('../apps/coach-mobile/src/CoachFormationScreen.js'),
    read('../apps/coach-mobile/src/CoachFormationBoard.js'),
  ])

  assert.match(screen, /registerBackHandler/)
  assert.match(screen, /<CoachFormationBoard[\s\S]*onBack=\{[^}]+\}[\s\S]*onMarkerGestureEnd=\{onMarkerGestureEnd\}[\s\S]*onMarkerGestureStart=\{onMarkerGestureStart\}[\s\S]*registerBackHandler=\{registerBackHandler\}/)
  assert.match(board, /accessibilityLabel="Back from Formation Board"/)
  assert.match(board, /saveCoachFormationLocalDraft[\s\S]*onBack\(\)/)
  assert.match(board, /registerBackHandler\?\.\(handleBack\)/)
  assert.equal((board.match(/<Modal[^\n]*>\s*<SafeAreaProvider>\s*<SafeAreaView edges=\{\['top', 'right', 'bottom', 'left'\]\}/g) || []).length, 2, 'Each native sheet measures its own safe area')
  assert.match(board, /beginGesture[\s\S]*onGestureStart\?\.\(\)[\s\S]*onPanResponderGrant: this\.prepareGesture/)
  assert.match(board, /endGesture[\s\S]*onGestureEnd\?\.\(\)[\s\S]*onPanResponderRelease[\s\S]*this\.endGesture\(\)[\s\S]*onPanResponderTerminate[\s\S]*this\.endGesture\(\)/)
})
