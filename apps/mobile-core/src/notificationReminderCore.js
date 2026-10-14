import { getMobileNotificationIndicator, MOBILE_SETTING_LOAD_STATES } from './deviceSettingsCore.js'

export function notificationReminderKey(appRole, userId) {
  if (!['coach', 'parent'].includes(appRole) || !/^[a-zA-Z0-9._-]{1,128}$/.test(String(userId || ''))) return null
  return `fp.notification-reminder.v1.${appRole}.${userId}`
}

export function shouldShowNotificationReminder({ state, status, offline = false, busy = false }) {
  return Boolean(state && typeof state === 'object' && !Array.isArray(state) && !offline && !busy && status === MOBILE_SETTING_LOAD_STATES.READY && !getMobileNotificationIndicator(state, status).enabled)
}

export function createNotificationReminderController({ storage, onChange, completed = new Set() }) {
  let generation = 0, scopeKey = null, visible = false
  const emit = (key, next) => {
    if (scopeKey !== key) return
    visible = next
    onChange({ key, visible: next })
  }
  const remember = async key => { try { await storage.write(key, '1') } catch { /* Keep the dismissal for this visit if device storage is unavailable. */ } }
  return {
    async check(options) {
      const key = notificationReminderKey(options.appRole, options.userId), token = ++generation
      if (scopeKey !== key) { scopeKey = key; emit(key, false) }
      if (!key || !options.state || typeof options.state !== 'object' || Array.isArray(options.state) || options.offline || options.busy || options.status !== MOBILE_SETTING_LOAD_STATES.READY) { emit(key, false); return }
      if (completed.has(key)) { emit(key, false); return }
      try {
        const seen = await storage.read(key)
        if (generation !== token || scopeKey !== key) return
        if (seen === '1' || !shouldShowNotificationReminder(options)) {
          completed.add(key)
          emit(key, false)
          if (seen !== '1') await remember(key)
        } else emit(key, true)
      } catch { if (generation === token) emit(key, false) }
    },
    dismiss(key) {
      if (!key || key !== scopeKey || !visible) return false
      generation += 1
      completed.add(key)
      emit(key, false)
      void remember(key)
      return true
    },
    dispose() { generation += 1; scopeKey = null; visible = false },
  }
}
