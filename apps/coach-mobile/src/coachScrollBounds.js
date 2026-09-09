// Native scrolling owns the gesture. Correct a stale offset only after touch,
// dragging and momentum have all stopped, using the latest layout measurements.
export function createCoachScrollBounds(scrollTo, clock = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
}) {
  let contentHeight = 0
  let viewportHeight = 0
  let offset = 0
  let touching = false
  let dragging = false
  let momentum = false
  let timer = null

  const cancel = () => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }
  const settle = () => {
    cancel()
    if (touching || dragging || momentum) return
    timer = clock.setTimeout(() => {
      timer = null
      if (touching || dragging || momentum || viewportHeight <= 0) return
      const maximumOffset = Math.max(0, contentHeight - viewportHeight)
      if (offset > maximumOffset + 2) {
        offset = maximumOffset
        scrollTo({ animated: false, y: maximumOffset })
      }
    }, 120)
  }
  const readOffset = (event) => {
    const y = event?.nativeEvent?.contentOffset?.y
    if (Number.isFinite(y)) offset = Math.max(0, y)
  }
  return {
    resetOffset(y = 0) {
      cancel()
      offset = Math.max(0, y)
      touching = dragging = momentum = false
    },
    dispose: cancel,
    handlers: {
      onContentSizeChange(_width, height) { contentHeight = height; settle() },
      onLayout(event) { viewportHeight = event.nativeEvent.layout.height; settle() },
      onScroll(event) { readOffset(event); settle() },
      onTouchStart() { touching = true; cancel() },
      onTouchEnd() { touching = false; settle() },
      onTouchCancel() { touching = false; dragging = false; settle() },
      onScrollBeginDrag() { dragging = true; momentum = false; cancel() },
      onScrollEndDrag(event) { readOffset(event); dragging = false; settle() },
      onMomentumScrollBegin() { momentum = true; cancel() },
      onMomentumScrollEnd(event) { readOffset(event); momentum = false; dragging = false; settle() },
    },
  }
}
