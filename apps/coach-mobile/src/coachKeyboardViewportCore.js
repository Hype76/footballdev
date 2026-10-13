// Keep navigation out of the keyboard viewport and reveal the active input
// after native layout has caught up. No polling or stored player values.
export function createCoachKeyboardViewport({ keyboard, platform, scrollRef, getFocusedInput, getScrollOffset,
  onVisibilityChange, requestFrame, cancelFrame }) {
  let visible = Boolean(keyboard.isVisible?.())
  let frame = null
  let subscriptions = []
  let keyboardTop = keyboard.metrics?.()?.screenY
  let revision = 0
  const clearFrame = () => {
    revision += 1
    if (frame !== null) cancelFrame(frame)
    frame = null
  }
  const ensureFocusedField = () => {
    clearFrame()
    if (!visible) return
    const currentRevision = revision
    frame = requestFrame(() => {
      frame = null
      if (!visible) return
      const input = getFocusedInput()
      const scroll = scrollRef.current
      const current = () => visible && revision === currentRevision
        && getFocusedInput() === input && scrollRef.current === scroll
      if (!input?.measureInWindow || !scroll?.measureInWindow) return
      scroll.measureInWindow((_scrollX, scrollY, _scrollWidth, scrollHeight) => {
        if (!current()) return
        input.measureInWindow((_inputX, inputY, _inputWidth, inputHeight) => {
          if (!current() || ![scrollY, scrollHeight, inputY, inputHeight].every(Number.isFinite)
            || scrollHeight <= 0 || inputHeight <= 0) return
          const top = scrollY + 24
          const bottom = Math.min(scrollY + scrollHeight, Number.isFinite(keyboardTop) ? keyboardTop : Infinity) - 24
          if (bottom <= top) return
          // Use window coordinates because the fixed header means this scroll
          // view does not fill the screen. Leave oversized visible fields stable.
          const delta = inputHeight > bottom - top
            ? (inputY > top || inputY + inputHeight < bottom ? inputY - top : 0)
            : inputY < top ? inputY - top : Math.max(0, inputY + inputHeight - bottom)
          const offset = getScrollOffset()
          if (Math.abs(delta) > 1 && Number.isFinite(offset)) {
            scroll.scrollTo({ animated: false, y: Math.max(0, offset + delta) })
          }
        })
      })
    })
  }
  const readKeyboardTop = event => { keyboardTop = event?.endCoordinates?.screenY ?? keyboard.metrics?.()?.screenY }
  const show = event => { visible = true; readKeyboardTop(event); onVisibilityChange(true); ensureFocusedField() }
  const hide = () => { visible = false; keyboardTop = undefined; clearFrame(); onVisibilityChange(false) }
  const resize = event => { if (visible) { readKeyboardTop(event); ensureFocusedField() } }
  return {
    ensureFocusedField,
    start() {
      visible = Boolean(keyboard.isVisible?.())
      keyboardTop = keyboard.metrics?.()?.screenY
      subscriptions = [keyboard.addListener('keyboardDidShow', show), keyboard.addListener('keyboardDidHide', hide)]
      if (platform === 'ios') subscriptions.push(keyboard.addListener('keyboardWillShow', show), keyboard.addListener('keyboardWillHide', hide),
        keyboard.addListener('keyboardWillChangeFrame', resize), keyboard.addListener('keyboardDidChangeFrame', resize))
      onVisibilityChange(visible)
    },
    dispose() { clearFrame(); subscriptions.forEach(subscription => subscription.remove()); subscriptions = []; visible = false },
  }
}
