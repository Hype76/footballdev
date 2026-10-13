// Keep navigation out of the keyboard viewport and reveal the active input
// after native layout has caught up. No polling or stored player values.
export function createCoachKeyboardViewport({ keyboard, platform, scrollRef, getFocusedInput,
  onVisibilityChange, requestFrame, cancelFrame }) {
  let visible = Boolean(keyboard.isVisible?.())
  let frame = null
  let subscriptions = []
  const clearFrame = () => {
    if (frame !== null) cancelFrame(frame)
    frame = null
  }
  const ensureFocusedField = () => {
    clearFrame()
    if (!visible) return
    frame = requestFrame(() => {
      frame = null
      if (!visible) return
      const input = getFocusedInput()
      if (input) scrollRef.current?.getScrollResponder?.()
        ?.scrollResponderScrollNativeHandleToKeyboard?.(input, 24, true)
    })
  }
  const show = () => { visible = true; onVisibilityChange(true); ensureFocusedField() }
  const hide = () => { visible = false; clearFrame(); onVisibilityChange(false) }
  return {
    ensureFocusedField,
    start() {
      visible = Boolean(keyboard.isVisible?.())
      subscriptions = [keyboard.addListener('keyboardDidShow', show), keyboard.addListener('keyboardDidHide', hide)]
      if (platform === 'ios') subscriptions.push(keyboard.addListener('keyboardWillShow', show), keyboard.addListener('keyboardWillHide', hide))
      onVisibilityChange(visible)
    },
    dispose() { clearFrame(); subscriptions.forEach(subscription => subscription.remove()); subscriptions = []; visible = false },
  }
}
