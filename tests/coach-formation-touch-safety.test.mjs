import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8')
const classStart = source.indexOf('class FormationPlayerMarker')
const renderStart = source.indexOf('\n  render()', classStart)
const markerClass = `${source.slice(classStart, renderStart)}\n}`.replace('class FormationPlayerMarker', 'class TestFormationPlayerMarker')

const createMarkerClass = () => {
  const timers = []
  const cleared = new Set()
  const vibrated = []
  const PanResponder = {
    create: (config) => ({ panHandlers: config }),
  }
  const context = vm.createContext({
    Component: class Component {
      setState(update) { this.state = { ...this.state, ...update } }
    },
    PanResponder,
    Vibration: { vibrate: (duration) => vibrated.push(duration) },
    clearTimeout: (timer) => cleared.add(timer),
    getMobileFormationPitchRatio: (value) => Number(value),
    Math,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay }
      timers.push(timer)
      return timer
    },
  })
  const Marker = new vm.Script(`(${markerClass})`).runInContext(context)
  return { Marker, cleared, timers, vibrated }
}

const propsFor = (overrides = {}) => ({
  canEdit: true,
  canMove: true,
  layout: { height: 100, width: 100 },
  onGestureEnd: () => {},
  onGestureStart: () => {},
  onMove: () => {},
  onPress: () => {},
  player: { x: 0.5, y: 0.5 },
  ...overrides,
})

const makeMarker = (Marker, props) => {
  const marker = new Marker(props)
  marker.props = props
  return marker
}

const press = (marker, gesture = {}) => marker.panResponder.panHandlers.onPanResponderGrant()
const move = (marker, gesture) => marker.panResponder.panHandlers.onPanResponderMove({}, { numberActiveTouches: 1, dx: 0, dy: 0, ...gesture })
const release = (marker, gesture = {}) => marker.panResponder.panHandlers.onPanResponderRelease({}, { numberActiveTouches: 1, dx: 0, dy: 0, ...gesture })

test('hold activates drag after 350ms with vibration and highlight state', () => {
  const { Marker, timers, vibrated } = createMarkerClass()
  let started = 0
  const marker = makeMarker(Marker, propsFor({ onGestureStart: () => { started += 1 } }))

  press(marker)
  assert.equal(started, 0)
  assert.equal(timers[0].delay, 350)
  timers[0].callback()

  assert.equal(started, 1)
  assert.equal(marker.gestureActive, true)
  assert.equal(marker.state.dragging, true)
  assert.deepEqual(vibrated, [20])
})

test('movement before the hold cancels the gesture and does not tap or move', () => {
  const { Marker, timers } = createMarkerClass()
  let pressed = 0
  let moved = 0
  const marker = makeMarker(Marker, propsFor({ onMove: () => { moved += 1 }, onPress: () => { pressed += 1 } }))

  press(marker)
  move(marker, { dx: 9 })
  timers[0].callback()
  release(marker, { dx: 9 })

  assert.equal(marker.gestureActive, false)
  assert.equal(pressed, 0)
  assert.equal(moved, 0)
})

test('termination ends an active hold so the parent can resume scrolling', () => {
  const { Marker, timers } = createMarkerClass()
  let ended = 0
  const marker = makeMarker(Marker, propsFor({ onGestureEnd: () => { ended += 1 } }))

  press(marker)
  timers[0].callback()
  marker.panResponder.panHandlers.onPanResponderTerminate()

  assert.equal(ended, 1)
  assert.equal(marker.gestureActive, false)
})

test('deliberate movement after the hold commits the player position', () => {
  const { Marker, timers } = createMarkerClass()
  const moves = []
  const marker = makeMarker(Marker, propsFor({ onMove: (position) => moves.push(position) }))

  press(marker)
  timers[0].callback()
  move(marker, { dx: 20, dy: -10 })
  release(marker, { dx: 20, dy: -10 })

  assert.equal(moves.length, 1)
  assert.equal(moves[0].x, 0.7)
  assert.equal(moves[0].y, 0.4)
})

test('releasing after the hold without movement does not trigger a tap', () => {
  const { Marker, timers } = createMarkerClass()
  let pressed = 0
  const marker = makeMarker(Marker, propsFor({ onPress: () => { pressed += 1 } }))

  press(marker)
  timers[0].callback()
  release(marker)

  assert.equal(pressed, 0)
  assert.equal(marker.gestureActive, false)
})
