function staleContextError() {
  return Object.assign(new Error('The Coach account or workspace changed.'), { code: 'coach_context_changed' })
}

export function isCoachAuthorityConnectionFailure(error) {
  if (error?.code === '42501' || [401, 403].includes(Number(error?.status))) return false
  return /network request failed|failed to fetch|fetch failed|networkerror|offline|timed? ?out|timeout|connection|internet/i.test(String(error?.message || error || ''))
}

// The queue preserves activation order. An older response cannot unlock a newer workspace.
export function createCoachContextAuthority(activate) {
  let generation = 0
  let queue = Promise.resolve()
  let selectedScope = ''
  return {
    invalidate() { generation += 1 },
    getGeneration() { return generation },
    async waitForRead(userId, contextId) {
      const scope = JSON.stringify([userId, contextId])
      const pending = queue
      const result = await pending
      if (pending !== queue || scope !== selectedScope) throw staleContextError()
      if (result?.offline) throw new Error('Coach workspace is offline. Saved information remains available.')
    },
    synchronize({ user, context, isCurrent = () => true }) {
      selectedScope = JSON.stringify([user?.id, context?.id])
      const request = ++generation
      const current = () => request === generation && isCurrent()
      const pending = queue.catch(() => {}).then(async () => {
        if (!current()) throw staleContextError()
        if (!user?.id || !context?.id || !context?.clubId) throw new Error('Choose an authorised Coach workspace.')
        if (user.isOfflineProfile) return { offline: true }
        try {
          const { error } = await activate(context.clubId)
          if (error) throw error
          if (!current()) throw staleContextError()
          return { offline: false }
        } catch (error) {
          if (!current()) throw staleContextError()
          if (isCoachAuthorityConnectionFailure(error)) return { offline: true }
          throw error
        }
      })
      queue = pending
      return pending
    },
  }
}


export function watchCoachConnection({ probe, isActive, onOffline, schedule = setInterval, cancel = clearInterval }) {
  let pending
  let stopped = false
  let consecutiveFailures = 0
  let consecutiveSuccesses = 0
  const timer = schedule(async () => {
    if (stopped || pending || !isActive()) return
    const controller = new AbortController()
    pending = controller
    const timeout = setTimeout(() => controller.abort(), 5000)
    let failure
    try { ({ error: failure } = await probe(controller.signal)) }
    catch (error) { failure = error }
    finally { clearTimeout(timeout); pending = null }
    if (stopped || !isActive()) return
    const failed = controller.signal.aborted || isCoachAuthorityConnectionFailure(failure)
    consecutiveFailures = failed ? consecutiveFailures + 1 : 0
    consecutiveSuccesses = failed ? 0 : consecutiveSuccesses + 1
    if (consecutiveFailures >= 2) onOffline(true)
    else if (consecutiveSuccesses >= 2) onOffline(false)
  }, 15000)
  return () => { stopped = true; cancel(timer); pending?.abort() }
}
