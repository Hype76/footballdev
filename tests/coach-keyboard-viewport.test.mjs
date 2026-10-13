import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoachKeyboardViewport } from '../apps/coach-mobile/src/coachKeyboardViewportCore.js'

function fixture(platform = 'ios') {
  const listeners = new Map(), frames = new Map(), visibility = [], scrolls = [], measurements = []
  let next = 0, offset = 300, isVisible = false, delayed = false
  const input = (id, absoluteY = 778, height = 96) => ({ id,
    measureInWindow: callback => callback(0, absoluteY - offset, 320, height) })
  let focused = input('summary')
  const scroll = { measureInWindow(callback) {
    if (delayed) measurements.push(callback)
    else callback(0, 148, 320, 330)
  }, scrollTo(options) { scrolls.push(options); offset = options.y } }
  const controller = createCoachKeyboardViewport({
    platform, keyboard: { isVisible: () => isVisible, metrics: () => ({ screenY: 478 }), addListener(name, callback) {
      listeners.set(name, callback); return { remove: () => listeners.delete(name) }
    } },
    scrollRef: { current: scroll }, getScrollOffset: () => offset,
    getFocusedInput: () => focused, onVisibilityChange: value => visibility.push(value),
    requestFrame: callback => { frames.set(++next, callback); return next }, cancelFrame: id => frames.delete(id),
  })
  controller.start()
  return { controller, listeners, visibility, scrolls, frames, measurements, input, offset: () => offset,
    bounds: value => { let result; value.measureInWindow((_x, y, _width, height) => { result = {top:y, bottom:y+height} }); return result },
    delay: () => { delayed = true },
    focus: input => { focused = input }, visible: value => { isVisible = value },
    emit: (name, screenY = 478) => listeners.get(name)?.({endCoordinates:{screenY, height:806-screenY}}), flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()) } }
}

test('iOS removes navigation before the keyboard animation and reveals the latest focused input', () => {
  const f = fixture()
  assert.deepEqual(f.visibility, [false])
  f.emit('keyboardWillShow')
  assert.equal(f.visibility.at(-1), true)
  const comment = f.input('coach-comment')
  assert.equal(f.bounds(comment).top, 478, 'Screenshot box initially starts at the keyboard edge')
  f.focus(comment)
  f.emit('keyboardDidShow'); f.flush()
  assert.equal(f.offset(), 420)
  assert.deepEqual(f.bounds(comment), {top:358, bottom:454}, 'Entire box is above the keyboard and below the fixed header')
  const summary = f.input('summary', 1100)
  f.focus(summary); f.controller.ensureFocusedField(); f.flush()
  assert.deepEqual(f.bounds(summary), {top:358, bottom:454})
  f.controller.dispose()
})

test('Android uses native keyboard events and leaves navigation visible when no keyboard is open', () => {
  const f = fixture('android')
  assert.deepEqual([...f.listeners.keys()], ['keyboardDidShow', 'keyboardDidHide'])
  f.controller.ensureFocusedField(); f.flush(); assert.equal(f.scrolls.length, 0)
  f.emit('keyboardDidShow'); f.flush(); assert.equal(f.scrolls.length, 1)
  f.emit('keyboardDidHide'); assert.equal(f.visibility.at(-1), false)
  f.controller.dispose()
})

test('hide and disposal cancel queued scroll work without changing any form state', () => {
  const f = fixture()
  f.emit('keyboardWillShow'); f.emit('keyboardWillHide'); f.flush()
  assert.equal(f.scrolls.length, 0)
  f.emit('keyboardDidShow'); f.controller.dispose(); f.flush()
  assert.equal(f.scrolls.length, 0); assert.equal(f.listeners.size, 0)
  f.visible(true); f.controller.start(); assert.equal(f.visibility.at(-1), true)
  f.focus(null); f.controller.ensureFocusedField(); f.flush(); assert.equal(f.scrolls.length, 0)
  f.controller.dispose()
})

test('third-party keyboard height changes reveal the box without another show event or repeated scrolls', () => {
  const f = fixture(), comment = f.input('overall-comments')
  f.focus(comment); f.emit('keyboardDidShow'); f.flush()
  f.emit('keyboardWillChangeFrame', 430); f.flush()
  assert.deepEqual(f.bounds(comment), {top:310, bottom:406})
  assert.equal(f.scrolls.length, 2)
  f.emit('keyboardDidChangeFrame', 430); f.flush()
  assert.equal(f.scrolls.length, 2, 'A settled visible box does not move again')
  f.controller.dispose()
})

test('visible fields and oversized fields spanning the viewport remain stable', () => {
  const f = fixture()
  f.focus(f.input('visible', 550)); f.emit('keyboardDidShow'); f.flush()
  assert.equal(f.scrolls.length, 0)
  f.focus(f.input('large', 430, 600)); f.controller.ensureFocusedField(); f.flush()
  assert.equal(f.scrolls.length, 0)
  f.controller.dispose()
})

test('a field above the fixed header scrolls into view without negative offsets', () => {
  const f = fixture(), input = f.input('earlier-comment', 420)
  f.focus(input); f.emit('keyboardDidShow'); f.flush()
  assert.equal(f.bounds(input).top, 172)
  assert.equal(f.offset(), 248)
  f.controller.dispose()
})

test('stale native measurements cannot move a different focused field or a hidden keyboard', () => {
  const f = fixture(); f.delay(); f.emit('keyboardDidShow'); f.flush()
  f.focus(f.input('new-comment', 1100)); f.controller.ensureFocusedField(); f.flush()
  f.measurements.shift()(0, 148, 320, 330)
  assert.equal(f.scrolls.length, 0)
  f.emit('keyboardDidHide'); f.measurements.shift()(0, 148, 320, 330)
  assert.equal(f.scrolls.length, 0)
  f.controller.dispose()
})
