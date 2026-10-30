export const parentCalendarDependencies = ['calendar', 'invitations', 'matches']

export function isParentAccessDenied(error) {
  return Number(error?.status || error?.statusCode) === 403
    || String(error?.code || '') === '42501'
    || /permission denied|not authori[sz]ed|access denied/i.test(String(error?.message || ''))
}

export function resolveParentResourceFailure(current, error, fallback) {
  const denied = isParentAccessDenied(error)
  return { error: denied ? 'Your current access does not allow this information to be shown.' : fallback, items: denied ? [] : current.items, loading: false }
}

export function resolveParentCalendarRefresh(current, settled, buildCalendar) {
  if (parentCalendarDependencies.some((name) => settled[name]?.status === 'rejected' && isParentAccessDenied(settled[name].reason))) {
    return { error: 'Your current access does not allow these Calendar items to be shown.', items: [], loading: false }
  }
  if (!parentCalendarDependencies.every((name) => settled[name])) return current
  if (parentCalendarDependencies.some((name) => settled[name].status === 'rejected')) {
    return { ...current, error: 'Some Calendar items could not be refreshed.', loading: false }
  }
  return { error: '', items: buildCalendar(settled), loading: false }
}

export function createParentChatRequestGate() {
  let generation = 0
  return {
    begin(scope) { return { generation: ++generation, scope } },
    invalidate() { generation += 1 },
    isCurrent(request, scope) { return request.generation === generation && request.scope === scope },
  }
}

export function discardDeniedParentCache(document, linkId, names = [], roomId = '') {
  const entry = document?.resources?.[linkId]
  if (!entry) return document
  const allowed = new Set(['calendar', 'chatHistory', 'chatRooms', 'development', 'invitations', 'matches', 'messages', 'notifications', 'polls', 'resources'])
  const next = { ...entry }
  for (const name of names) if (allowed.has(name)) delete next[name]
  if (roomId && Array.isArray(next.chatHistory?.value)) {
    next.chatHistory = { ...next.chatHistory, value: next.chatHistory.value.filter((message) => message.roomId !== roomId) }
  }
  return { ...document, resources: { ...document.resources, [linkId]: next } }
}

export function shouldClearParentChatOnSettlement(name, result) {
  return name === 'chatRooms' && result?.status === 'rejected' && isParentAccessDenied(result.reason)
}

export function filterDeniedParentChatHistory(items, deniedScopes, scopeForRoom, denyAll = false) {
  if (denyAll) return []
  return (Array.isArray(items) ? items : []).filter((message) => !deniedScopes.has(scopeForRoom(message.roomId)))
}
