import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoachScrollBounds } from '../apps/coach-mobile/src/coachScrollBounds.js'

const event = (y) => ({ nativeEvent: { contentOffset: { y } } })
function setup() {
  const timers = new Map()
  let nextId = 0
  const calls = []
  const controller = createCoachScrollBounds((value) => calls.push(value), {
    setTimeout(fn) { timers.set(++nextId, fn); return nextId },
    clearTimeout(id) { timers.delete(id) },
  })
  const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()) }
  const handlers = controller.handlers
  handlers.onLayout({ nativeEvent: { layout: { height: 480 } } })
  handlers.onContentSizeChange(390, 1000)
  return { controller, handlers, calls, flush }
}

test('a held finger is never interrupted by a layout or content correction', () => {
  const { handlers, calls, flush } = setup()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  handlers.onScroll(event(450))
  handlers.onContentSizeChange(390, 500)
  handlers.onLayout({ nativeEvent: { layout: { height: 492 } } })
  for (let step = 0; step < 8; step++) { handlers.onScroll(event(12)); flush() }
  assert.deepEqual(calls, [])
  handlers.onScrollEndDrag(event(12))
  flush()
  assert.deepEqual(calls, [], 'Drag-end alone cannot override a finger still down')
  handlers.onTouchEnd()
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 8 }])
})

test('momentum and renewed touch cancel a pending correction', () => {
  const { handlers, calls, flush } = setup()
  handlers.onScroll(event(450))
  handlers.onContentSizeChange(390, 600)
  handlers.onScrollEndDrag(event(450))
  handlers.onMomentumScrollBegin()
  flush()
  assert.deepEqual(calls, [])
  handlers.onMomentumScrollEnd(event(450))
  handlers.onTouchStart()
  flush()
  assert.deepEqual(calls, [])
  handlers.onTouchCancel()
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 120 }])
})

test('settling uses the latest geometry and native offset, not a stale target', () => {
  const { handlers, calls, flush } = setup()
  handlers.onScroll(event(450))
  handlers.onContentSizeChange(390, 600)
  handlers.onContentSizeChange(390, 1100)
  flush()
  assert.deepEqual(calls, [], 'Restored content no longer needs correction')
  handlers.onContentSizeChange(390, 600)
  handlers.onScroll(event(120))
  flush()
  assert.deepEqual(calls, [], 'Native correction has already restored a valid position')
})

test('removing Poll content still corrects a stale resting offset once', () => {
  const { handlers, calls, flush } = setup()
  handlers.onScroll(event(500))
  handlers.onContentSizeChange(390, 700)
  flush()
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 220 }])
})

test('route resets and unmount cancel old-page corrections', () => {
  const { controller, handlers, calls, flush } = setup()
  handlers.onScroll(event(500))
  handlers.onContentSizeChange(390, 600)
  controller.resetOffset()
  flush()
  assert.deepEqual(calls, [])
  handlers.onScroll(event(500))
  controller.dispose()
  flush()
  assert.deepEqual(calls, [])
})

test('missing viewport measurements and two-pixel rounding never force a jump', () => {
  const { handlers, calls, flush } = setup()
  handlers.onScroll(event(522))
  flush()
  assert.deepEqual(calls, [])
  handlers.onLayout({ nativeEvent: { layout: { height: 0 } } })
  handlers.onContentSizeChange(390, 50)
  flush()
  assert.deepEqual(calls, [])
})
