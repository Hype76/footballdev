export function createCoachAccountPreparationCoordinator() {
  let running = null
  const queue = []
  const listeners = new Map()
  const snapshot = userId => running?.userId === userId
    ? { active: alive(running), statuses: { ...running.statuses } } : { active: false, statuses: {} }
  const emit = userId => {
    if (!listeners.has(userId)) return
    for (const listener of listeners.get(userId)) listener(snapshot(userId))
  }
  const current = caller => { try { return caller() } catch { return false } }
  const alive = job => job.callers.some(current)
  const drain = () => {
    if (running) return
    const job = queue.shift()
    if (!job) return
    if (!alive(job)) { job.resolve({ cancelled: true }); drain(); return }
    running = job
    emit(job.userId)
    Promise.resolve().then(() => job.run(() => alive(job), (id, status) => {
      if (!alive(job)) return
      job.statuses[id] = status
      emit(job.userId)
    })).then(
      result => { finish(job); job.resolve(result) },
      error => { finish(job); job.reject(error) },
    )
  }
  const finish = job => {
    running = null
    emit(job.userId)
    drain()
  }
  return {
    subscribe(userId, listener) {
      if (!listeners.has(userId)) listeners.set(userId, new Set())
      listeners.get(userId).add(listener)
      listener(snapshot(userId))
      return () => {
        const subscribers = listeners.get(userId)
        subscribers?.delete(listener)
        if (!subscribers?.size) listeners.delete(userId)
      }
    },
    notify(userId) { emit(userId) },
    run(key, caller, run, userId = '') {
      const matching = [running, ...queue].find(job => job && job.key === key && alive(job))
      if (matching) { matching.callers.push(caller); return matching.promise }
      const job = { key, callers: [caller], run, userId, statuses: {} }
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject })
      queue.push(job)
      drain()
      return job.promise
    },
  }
}

export function coachPreparationScopeKey(userId, generation, contexts) {
  const fields = ['id', 'authorityId', 'authoritySource', 'clubId', 'teamId', 'role', 'roleRank', 'clubStatus', 'teamStatus', 'archivedAt', 'planKey', 'planStatus', 'hasActivePlanAccess']
  const rows = contexts.map(context => fields.map(key => String(context[key] ?? '')))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return JSON.stringify([userId, generation ?? null, rows])
}