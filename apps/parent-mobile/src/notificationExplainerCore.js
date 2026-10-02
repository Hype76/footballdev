export function notificationPermissionState(permission, platform, channel) {
  const iosStatus = permission?.ios?.status
  const quiet = platform === 'ios' && (iosStatus === 3 || permission?.ios?.allowsAlert === false)
  const granted = platform === 'ios'
    ? [2, 3, 4].includes(iosStatus)
    : permission?.granted === true
  const channelBlocked = platform === 'android' && channel?.importance === 0
  return {
    canAskAgain: permission?.canAskAgain !== false,
    permissionGranted: granted,
    permissionStatus: platform === 'ios' && iosStatus === 3 ? 'provisional' : platform === 'ios' && iosStatus === 4 ? 'ephemeral' : permission?.status || 'undetermined',
    quietDelivery: quiet,
    channelBlocked,
    visibleAlertsReady: granted && !quiet && !channelBlocked && (platform !== 'ios' || (iosStatus === 4 ? permission?.ios?.allowsAlert === true : permission?.ios?.allowsAlert !== false)),
  }
}

// AsyncStorage is installation-local. Account and API origin prevent cross-account/environment dismissal.
export function notificationExplainerKey(accountId, apiBaseUrl) {
  return `fp.parent.notification-explainer.v1.${encodeURIComponent(new URL(apiBaseUrl).origin)}.${encodeURIComponent(accountId)}`
}

export function notificationSetupChoice(state) {
  if (state.channelBlocked || state.quietDelivery || (state.permissionGranted && !state.visibleAlertsReady)) return 'Open phone settings'
  if (state.permissionGranted) return state.registered ? null : 'Finish setup'
  if (!['undetermined', 'denied'].includes(state.permissionStatus)) return null
  return state.canAskAgain ? 'Turn on' : 'Open phone settings'
}

export function respectsNotificationChoices({ state, communication, categories, paused }) {
  return !paused && !(state.registered && !state.enabled)
    && communication?.communicationChannel !== 'email'
    && categories?.gameDay !== 'off' && categories?.invites !== false
    && categories?.chats !== false && categories?.resources !== false
}

export function createNotificationExplainer({ storage, key, load, setup, openSettings, publish, now = Date.now }) {
  let alive = true, revision = 0, busy = false, continuation = null
  let snapshot = { ready: false, dismissed: true, data: null, error: '', busy: false }
  const emit = patch => { if (alive) { snapshot = { ...snapshot, ...patch }; publish(snapshot) } }
  async function refresh() {
    const request = ++revision
    emit({ ready: false })
    try {
      const [saved, data, paused] = await Promise.all([storage.getItem(key), load(), storage.getItem(`${key}.paused`)])
      if (!alive || request !== revision) return null
      if (data.state.registered && !data.state.enabled) await storage.setItem(`${key}.paused`, '1')
      if (!alive || request !== revision) return null
      const eligible = respectsNotificationChoices({ ...data, paused: paused === '1' })
      emit({ ready: true, dismissed: saved === '1', data: { ...data, eligible } })
      return snapshot.data
    } catch {
      if (request === revision) emit({ ready: false, error: 'Connect and retry notification setup. Your saved choices have not been changed.' })
      return null
    }
  }
  async function dismiss() {
    continuation = null
    emit({ dismissed: true })
    await storage.setItem(key, '1')
  }
  async function register(data) {
    if (!alive || !data?.eligible) return
    const next = await setup(() => alive && data.eligible)
    if (alive) emit({ data: { ...data, state: next }, error: next.permissionGranted ? '' : 'Phone permission is still off. You can view updates in the app.' })
  }
  async function act() {
    if (!alive || busy) return
    busy = true; emit({ busy: true, error: '', initiated: true })
    try {
      const data = await refresh()
      if (!alive || !data?.eligible) return
      const choice = notificationSetupChoice(data.state)
      if (!choice) return
      await dismiss()
      if (!alive) return
      if (choice === 'Open phone settings') {
        continuation = { expires: now() + 120000, left: false }
        await openSettings()
      } else await register(data)
    } catch {
      continuation = null
      emit({ error: 'Notification setup could not be completed. Open Settings to retry. Updates remain available in the app.' })
    } finally { busy = false; emit({ busy: false }) }
  }
  async function appState(next) {
    if (next !== 'active') { if (continuation) continuation.left = true; return }
    if (busy) return
    const current = continuation
    continuation = null
    busy = true; emit({ busy: true })
    try {
      const data = await refresh()
      if (alive && current?.left && current.expires >= now() && data?.eligible && data.state.permissionGranted && data.state.visibleAlertsReady && !data.state.registered) await register(data)
    } catch { emit({ error: 'Setup is unfinished. Open Settings to retry. Updates remain available in the app.' }) }
    finally { busy = false; emit({ busy: false }) }
  }
  return { refresh, dismiss, act, appState, dispose() { alive = false; revision++; continuation = null } }
}
