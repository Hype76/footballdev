// Retain the newest input while one durable write finishes. Intermediate
// keystrokes must not each queue another whole encrypted-document transaction.
const activeDrains = new Map()

export function getPendingDevelopmentAutosave(scope) {
  return activeDrains.get(scope) || null
}

export function createDevelopmentAutosaveQueue(write, { scope = '', onSaved = () => {}, onError = () => {} } = {}) {
  let pending = null
  let running = null
  let receipt = null

  return {
    isSaving() { return running !== null },
    flush() { return running || Promise.resolve(receipt) },
    enqueue(input) {
      pending = input
      if (!running) {
        running = Promise.resolve().then(async () => {
          while (pending) {
            const next = pending
            pending = null
            try {
              receipt = await write(next)
            } catch (error) {
              // A newer snapshot still needs an attempt. Only the failure of
              // the newest input can report that the visible work is unsaved.
              if (pending) continue
              onError(error)
              throw error
            }
          }
          onSaved(receipt)
          return receipt
        }).finally(() => {
          if (scope && activeDrains.get(scope) === running) activeDrains.delete(scope)
          running = null
        })
        if (scope) activeDrains.set(scope, running)
      }
      return running
    },
  }
}
