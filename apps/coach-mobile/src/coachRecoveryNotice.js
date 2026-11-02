import { getCoachOfflineRecoveryMessage } from './coachOfflineErrors.js'

export function createCoachRecoveryNotice(storage, key) {
  let message = ''
  const listeners = new Set()
  const publish = value => {
    if (!value || message) return
    message = value
    for (const listener of listeners) listener(message)
  }
  return {
    async load() {
      if (await storage.getItem(key) === '1') publish(getCoachOfflineRecoveryMessage({ status: 'corrupt' }))
      return message
    },
    report(error) {
      const value = getCoachOfflineRecoveryMessage(error)
      if (!value) return
      publish(value)
      void storage.setItem(key, '1').catch(() => {})
    },
    subscribe(listener) {
      listeners.add(listener)
      if (message) listener(message)
      return () => listeners.delete(listener)
    },
  }
}
