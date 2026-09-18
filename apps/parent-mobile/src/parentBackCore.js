export function getParentBackPressAction({ atRoot = false, lastBackAt = 0, now = Date.now(), windowMs = 2000 } = {}) {
  if (!atRoot) return Object.freeze({ type: 'normal', nextLastBackAt: 0 })
  const elapsed = now - lastBackAt
  if (lastBackAt && elapsed >= 0 && elapsed < windowMs) return Object.freeze({ type: 'exit', nextLastBackAt: 0 })
  return Object.freeze({ type: 'prompt', message: 'Press Back again to exit', nextLastBackAt: now })
}
