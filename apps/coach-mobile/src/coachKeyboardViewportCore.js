// Keep navigation out of the keyboard viewport and reveal the active input
// after native layout has caught up. No polling or stored player values.
export function createCoachKeyboardViewport({ keyboard, platform, scrollRef, getFocusedInput, getScrollOffset,
  onVisibilityChange, requestFrame, cancelFrame }) {
  let visible = Boolean(keyboard.isVisible?.())
  let transitioning = false
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
    if (!visible || transitioning) return
    const currentRevision = revision
    frame = requestFrame(() => {
      frame = null
      if (!visible || transitioning) return
      const input = getFocusedInput()
      const scroll = scrollRef.current
      const current = () => visible && !transitioning && revision === currentRevision
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
          if (Math.abs(delta) <= 1) return
          const reveal = offset => {
            if (current() && Number.isFinite(offset)) {
              scroll.scrollTo({ animated: false, y: Math.max(0, offset + delta) })
            }
          }
          // onScroll reaches JS after native scrolling. Derive the offset from
          // the content origin so a late event cannot add an old offset again.
          const content = scroll.getInnerViewRef?.()
          if (content?.measureInWindow) {
            content.measureInWindow((_x, contentY) => {
              if (Number.isFinite(contentY)) reveal(scrollY - contentY)
            })
          } else reveal(getScrollOffset())
        })
      })
    })
  }
  const readKeyboardTop = event => { keyboardTop = event?.endCoordinates?.screenY ?? keyboard.metrics?.()?.screenY }
  const show = event => { visible = true; transitioning = false; readKeyboardTop(event); onVisibilityChange(true); ensureFocusedField() }
  const hide = () => { visible = false; transitioning = false; keyboardTop = undefined; clearFrame(); onVisibilityChange(false) }
  const willShow = event => {
    visible = true; transitioning = true; readKeyboardTop(event); clearFrame(); onVisibilityChange(true)
  }
  const willResize = event => { if (visible) { transitioning = true; readKeyboardTop(event); clearFrame() } }
  const resize = event => { if (visible) { transitioning = false; readKeyboardTop(event); ensureFocusedField() } }
  return {
    ensureFocusedField,
    start() {
      visible = Boolean(keyboard.isVisible?.())
      transitioning = false
      keyboardTop = keyboard.metrics?.()?.screenY
      subscriptions = [keyboard.addListener('keyboardDidShow', show), keyboard.addListener('keyboardDidHide', hide)]
      if (platform === 'ios') subscriptions.push(keyboard.addListener('keyboardWillShow', willShow), keyboard.addListener('keyboardWillHide', hide),
        keyboard.addListener('keyboardWillChangeFrame', willResize), keyboard.addListener('keyboardDidChangeFrame', resize))
      onVisibilityChange(visible)
    },
    dispose() { clearFrame(); subscriptions.forEach(subscription => subscription.remove()); subscriptions = []; visible = false },
  }
}
