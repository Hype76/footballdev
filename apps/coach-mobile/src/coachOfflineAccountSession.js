let userId = '', epoch = 0
export function activateCoachOfflineAccount(id) {
  if (id !== userId) { userId = id; epoch += 1 }
}
export function invalidateCoachOfflineAccount() { const previous = userId; userId = ''; epoch += 1; return previous }
export function captureCoachOfflineAccount(id) {
  const captured = epoch
  return () => {
    if (!id || id !== userId || captured !== epoch) throw new Error('offline_account_session_changed')
  }
}
