import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoachKeyboardViewport } from '../apps/coach-mobile/src/coachKeyboardViewportCore.js'

function fixture(platform = 'ios') {
  const listeners = new Map(), frames = new Map(), visibility = [], scrolls = []
  let next = 0, focused = { id: 'summary' }, isVisible = false
  const controller = createCoachKeyboardViewport({
    platform, keyboard: { isVisible: () => isVisible, addListener(name, callback) {
      listeners.set(name, callback); return { remove: () => listeners.delete(name) }
    } },
    scrollRef: { current: { getScrollResponder: () => ({ scrollResponderScrollNativeHandleToKeyboard: (...args) => scrolls.push(args) }) } },
    getFocusedInput: () => focused, onVisibilityChange: value => visibility.push(value),
    requestFrame: callback => { frames.set(++next, callback); return next }, cancelFrame: id => frames.delete(id),
  })
  controller.start()
  return { controller, listeners, visibility, scrolls, frames,
    focus: input => { focused = input }, visible: value => { isVisible = value },
    emit: name => listeners.get(name)?.(), flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()) } }
}

test('iOS removes navigation before the keyboard animation and reveals the latest focused input', () => {
  const f = fixture()
  assert.deepEqual(f.visibility, [false])
  f.emit('keyboardWillShow')
  assert.equal(f.visibility.at(-1), true)
  f.focus({ id: 'coach-comment' })
  f.emit('keyboardDidShow'); f.flush()
  assert.deepEqual(f.scrolls, [[{ id: 'coach-comment' }, 24, true]])
  f.focus({ id: 'summary' }); f.controller.ensureFocusedField(); f.flush()
  assert.deepEqual(f.scrolls.at(-1), [{ id: 'summary' }, 24, true])
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
