export function focusParentFormationBoard(target, content, scrollView) {
  if (!target || !content || !scrollView) return
  requestAnimationFrame(() => {
    target.measureLayout(content, (_x, y) => {
      scrollView.scrollTo({ animated: true, y: Math.max(0, y) })
    }, () => {})
  })
}
