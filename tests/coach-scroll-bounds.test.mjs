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

test('native scroll geometry corrects a stale short-page offset when layout callbacks are late', () => {
  const { handlers, calls, flush } = setup()
  handlers.onScroll({ nativeEvent: { contentOffset: { y: 180 }, layoutMeasurement: { height: 550 }, contentSize: { height: 320 } } })
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 0 }])
})

test('actual page and viewport layout override pre-keyboard native scroll metrics', () => {
  const { controller, handlers, calls, flush } = setup()
  controller.onPageLayout({ nativeEvent: { layout: { height: 1000 } } })
  handlers.onLayout({ nativeEvent: { layout: { height: 320 } } })
  handlers.onScroll(event(600))
  handlers.onLayout({ nativeEvent: { layout: { height: 600 } } })
  handlers.onScroll({ nativeEvent: { contentOffset: { y: 600 }, layoutMeasurement: { height: 320 }, contentSize: { height: 1000 } } })
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 400 }], 'Keyboard dismissal cannot retain 200 pixels of blank scroll range')
})

test('viewport layout stays authoritative before the first natural page measurement arrives', () => {
  const { controller, handlers, calls, flush } = setup()
  handlers.onLayout({ nativeEvent: { layout: { height: 600 } } })
  handlers.onScroll({ nativeEvent: { contentOffset: { y: 600 }, layoutMeasurement: { height: 320 }, contentSize: { height: 1000 } } })
  controller.onPageLayout({ nativeEvent: { layout: { height: 1000 } } })
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 400 }])
})

test('shrinking the rendered page cannot be undone by retained native content dimensions', () => {
  const { controller, handlers, calls, flush } = setup()
  controller.onPageLayout({ nativeEvent: { layout: { height: 1000 } } })
  handlers.onScroll(event(500))
  controller.onPageLayout({ nativeEvent: { layout: { height: 200 } } })
  handlers.onContentSizeChange(390, 2000)
  handlers.onScroll({ nativeEvent: { contentOffset: { y: 500 }, layoutMeasurement: { height: 480 }, contentSize: { height: 2000 } } })
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 0 }])
})

test('disposed page events cannot schedule corrections against the next page', () => {
  const { controller, handlers, calls, flush } = setup()
  controller.dispose()
  controller.onPageLayout({ nativeEvent: { layout: { height: 200 } } })
  handlers.onLayout({ nativeEvent: { layout: { height: 600 } } })
  handlers.onScroll({ nativeEvent: { contentOffset: { y: 700 }, layoutMeasurement: { height: 600 }, contentSize: { height: 200 } } })
  handlers.onScrollEndDrag(event(700))
  handlers.onMomentumScrollEnd(event(700))
  flush()
  assert.deepEqual(calls, [], 'Late events from an unmounted page have no live scroll target')
})

test('a fresh long page reports scrollability even when the previous page disabled it', () => {
  const changes = []
  const page = height => {
    const controller = createCoachScrollBounds(() => {}, undefined, value => changes.push(value))
    controller.onPageLayout({ nativeEvent: { layout: { height } } })
    controller.handlers.onLayout({ nativeEvent: { layout: { height: 600 } } })
    return controller
  }
  const short = page(200)
  short.dispose()
  const long = page(1000)
  assert.deepEqual(changes, [false, true])
  long.dispose()
})

test('effect reconnection reactivates the same mounted page after cleanup', () => {
  const { controller, handlers, calls, flush } = setup()
  controller.onPageLayout({ nativeEvent: { layout: { height: 1000 } } })
  controller.dispose()
  controller.activate()
  controller.onPageLayout({ nativeEvent: { layout: { height: 200 } } })
  handlers.onScroll(event(700))
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 0 }])
  controller.dispose()
})

test('reconnection cannot retain a disconnected native pan or momentum forever', () => {
  for (const gesture of ['pan', 'momentum']) {
    const { controller, handlers, calls, flush } = setup()
    controller.onPageLayout({ nativeEvent: { layout: { height: 1000 } } })
    handlers.onScroll(event(600))
    if (gesture === 'pan') { handlers.onTouchStart(); handlers.onScrollBeginDrag() }
    else handlers.onMomentumScrollBegin()
    controller.dispose()
    assert.equal(controller.isActive(), false)
    controller.activate()
    assert.equal(controller.isActive(), true)
    controller.onPageLayout({ nativeEvent: { layout: { height: 200 } } })
    flush()
    assert.deepEqual(calls, [{ animated: false, y: 0 }], gesture + ' ended while disconnected without a release event')
    controller.dispose()
  }
})

test('activation of an already live page does not release the current finger', () => {
  const { controller, handlers, calls, flush } = setup()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  controller.onPageLayout({ nativeEvent: { layout: { height: 200 } } })
  handlers.onScroll(event(600))
  controller.activate()
  flush()
  assert.deepEqual(calls, [])
  handlers.onScrollEndDrag(event(600))
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 0 }])
})

test('native drag release repairs an out-of-range page even when UIKit omits the raw touch-end callback', () => {
  const { handlers, calls, flush } = setup()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  handlers.onScroll({ nativeEvent: { contentOffset: { y: 700 }, layoutMeasurement: { height: 550 }, contentSize: { height: 320 } } })
  flush()
  assert.deepEqual(calls, [], 'The app does not fight an active pan')
  handlers.onScrollEndDrag({ nativeEvent: { contentOffset: { y: 700 }, velocity: { x: 0, y: 0 } } })
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 0 }], 'The native pan-end event releases the old touch guard')
})

test('native release waits for momentum without needing a raw touch-end event', () => {
  const { handlers, calls, flush } = setup()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  handlers.onContentSizeChange(390, 600)
  handlers.onScrollEndDrag({ nativeEvent: { contentOffset: { y: 450 }, velocity: { x: 0, y: 2 } } })
  handlers.onMomentumScrollBegin()
  flush()
  assert.deepEqual(calls, [])
  handlers.onMomentumScrollEnd(event(450))
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 120 }])
})

test('touching to stop old momentum never releases a newly held finger', () => {
  const { handlers, calls, flush } = setup()
  handlers.onScroll(event(450))
  handlers.onContentSizeChange(390, 600)
  handlers.onMomentumScrollBegin()
  handlers.onTouchStart()
  handlers.onScrollEndDrag(event(450))
  handlers.onMomentumScrollEnd(event(450))
  flush()
  assert.deepEqual(calls, [], 'A synthetic drag-end while stopping old momentum is not a new pan release')
  handlers.onTouchEnd()
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 120 }])
})

test('late momentum-end leaves the newer pan active until its own native release', () => {
  const { handlers, calls, flush } = setup()
  handlers.onScroll(event(450))
  handlers.onContentSizeChange(390, 600)
  handlers.onMomentumScrollBegin()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  handlers.onMomentumScrollEnd(event(450))
  flush()
  assert.deepEqual(calls, [])
  handlers.onScrollEndDrag(event(450))
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 120 }], 'The newer pan can settle without a raw touch-end callback')
})

test('raw touch cancellation does not end a native pan that has taken over the gesture', () => {
  const { handlers, calls, flush } = setup()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  handlers.onContentSizeChange(390, 600)
  handlers.onScroll(event(450))
  handlers.onTouchCancel()
  flush()
  assert.deepEqual(calls, [], 'The native pan still owns scrolling after cancelling the raw touch responder')
  handlers.onScrollEndDrag(event(450))
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 120 }])
})

test('late old momentum-end cannot release a newer native pan after raw touch cancellation', () => {
  const { handlers, calls, flush } = setup()
  handlers.onScroll(event(450))
  handlers.onContentSizeChange(390, 600)
  handlers.onMomentumScrollBegin()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  handlers.onTouchCancel()
  handlers.onMomentumScrollEnd(event(450))
  flush()
  assert.deepEqual(calls, [], 'Only the newer native pan release can end its ownership')
  handlers.onScrollEndDrag(event(450))
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 120 }])
})

test('late momentum-begin cannot keep an active newer pan stuck after its native release', () => {
  const { handlers, calls, flush } = setup()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  handlers.onContentSizeChange(390, 600)
  handlers.onScroll(event(450))
  handlers.onTouchCancel()
  handlers.onMomentumScrollBegin()
  handlers.onScrollEndDrag(event(450))
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 120 }], 'A native pan cannot also be starting momentum until its release')
})

test('short pages disable scrolling after a gesture ends and growing content enables it again', () => {
  const timers = new Map(), changes = []
  let id = 0
  const controller = createCoachScrollBounds(() => {}, { setTimeout(fn) { timers.set(++id, fn); return id }, clearTimeout(key) { timers.delete(key) } }, value => changes.push(value))
  controller.handlers.onContentSizeChange(390, 1000)
  controller.handlers.onLayout({ nativeEvent: { layout: { height: 600 } } })
  controller.handlers.onTouchStart()
  controller.handlers.onScrollBeginDrag()
  controller.handlers.onContentSizeChange(390, 320)
  assert.deepEqual(changes, [true], 'Layout changes never disable a scroll gesture under the finger')
  controller.handlers.onScrollEndDrag(event(180))
  controller.handlers.onTouchEnd()
  for (const fn of [...timers.values()]) fn()
  assert.deepEqual(changes, [true, false])
  controller.handlers.onContentSizeChange(390, 900)
  assert.deepEqual(changes, [true, false, true])
  controller.dispose()
})

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
  assert.deepEqual(calls, [{ animated: false, y: 8 }], 'A native pan release ends the gesture even if raw touch-end is omitted')
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

test('negative native offsets are repaired only after touch and momentum end', () => {
  const { controller, handlers, calls, flush } = setup()
  handlers.onTouchStart()
  handlers.onScrollBeginDrag()
  handlers.onScroll(event(-400))
  flush()
  assert.deepEqual(calls, [])
  assert.equal(controller.getOffset(), 0, 'Return positions never store a negative pull offset')
  handlers.onScrollEndDrag(event(-400))
  handlers.onTouchEnd()
  handlers.onMomentumScrollBegin()
  flush()
  assert.deepEqual(calls, [])
  handlers.onMomentumScrollEnd(event(-400))
  flush()
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 0 }])
})

test('both edges of short pages remain valid after a native offset settles', () => {
  const { handlers, calls, flush } = setup()
  handlers.onContentSizeChange(390, 200)
  handlers.onScroll(event(700))
  flush()
  handlers.onScroll(event(-100))
  flush()
  assert.deepEqual(calls, [{ animated: false, y: 0 }, { animated: false, y: 0 }])
  handlers.onScroll(event(-2))
  flush()
  assert.equal(calls.length, 2, 'Tiny native rounding at either edge is tolerated')
})
