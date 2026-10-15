// Native scrolling owns the gesture. Correct a stale offset only after touch,
// dragging and momentum have all stopped, using the latest layout measurements.
export function createCoachScrollBounds(scrollTo, clock = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
}, onScrollableChange = () => {}) {
  let contentHeight = 0
  let viewportHeight = 0
  let pageMeasured = false
  let viewportMeasured = false
  let disposed = false
  let offset = 0
  let touching = false
  let dragging = false
  let momentum = false
  let timer = null
  let scrollable = null

  const updateScrollable = () => {
    if (disposed || viewportHeight <= 0 || touching || dragging || momentum) return
    const next = contentHeight > viewportHeight + 2
    if (next !== scrollable) { scrollable = next; onScrollableChange(next) }
  }

  const cancel = () => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }
  const settle = () => {
    cancel()
    if (touching || dragging || momentum) return
    timer = clock.setTimeout(() => {
      timer = null
      if (disposed || touching || dragging || momentum || viewportHeight <= 0) return
      updateScrollable()
      const maximumOffset = Math.max(0, contentHeight - viewportHeight)
      if (offset > maximumOffset + 2) {
        offset = maximumOffset
        scrollTo({ animated: false, y: maximumOffset })
      } else if (offset < -2) {
        offset = 0
        scrollTo({ animated: false, y: 0 })
      }
    }, 120)
  }
  const readOffset = (event) => {
    const y = event?.nativeEvent?.contentOffset?.y
    if (Number.isFinite(y)) offset = y
    const nativeViewport = event?.nativeEvent?.layoutMeasurement?.height
    const nativeContent = event?.nativeEvent?.contentSize?.height
    // Native scroll events can retain pre-resize geometry. Once the actual
    // page and viewport have reported layout, those measurements own the bounds.
    if (!viewportMeasured && Number.isFinite(nativeViewport) && nativeViewport > 0) viewportHeight = nativeViewport
    if (!pageMeasured && Number.isFinite(nativeContent) && nativeContent >= 0) contentHeight = nativeContent
    updateScrollable()
  }
  const live = handler => (...args) => { if (!disposed) handler(...args) }
  return {
    getOffset() { return Math.max(0, offset) },
    isActive() { return !disposed },
    activate() {
      if (disposed) touching = dragging = momentum = false
      disposed = false
      updateScrollable(); settle()
    },
    resetOffset(y = 0) {
      if (disposed) return
      cancel()
      offset = Math.max(0, y)
      touching = dragging = momentum = false
    },
    dispose() { disposed = true; cancel() },
    onPageLayout: live(event => {
      const height = event?.nativeEvent?.layout?.height
      if (!Number.isFinite(height) || height < 0) return
      pageMeasured = true
      contentHeight = height
      updateScrollable(); settle()
    }),
    handlers: Object.fromEntries(Object.entries({
      onContentSizeChange(_width, height) { if (!pageMeasured) contentHeight = height; updateScrollable(); settle() },
      onLayout(event) { viewportHeight = event.nativeEvent.layout.height; viewportMeasured = viewportHeight > 0; updateScrollable(); settle() },
      onScroll(event) { readOffset(event); settle() },
      onTouchStart() { touching = true; cancel() },
      onTouchEnd() { touching = false; settle() },
      // UIKit can cancel raw touches when its scroll recognizer takes over.
      onTouchCancel() { touching = false; settle() },
      onScrollBeginDrag() { dragging = true; momentum = false; cancel() },
      onScrollEndDrag(event) {
        readOffset(event)
        // A native pan release can arrive without a raw touch-end callback.
        // A drag-end emitted only to stop old momentum must keep a new touch.
        if (dragging) touching = false
        dragging = false
        settle()
      },
      onMomentumScrollBegin() { if (dragging) return; momentum = true; cancel() },
      onMomentumScrollEnd(event) {
        readOffset(event)
        momentum = false
        // Momentum from the previous gesture cannot release a newer native pan.
        settle()
      },
    }).map(([name, handler]) => [name, live(handler)])),
  }
}
