export function createCoachAccountPreparationCoordinator() {
  let running = null
  const queue = []
  const current = caller => { try { return caller() } catch { return false } }
  const alive = job => job.callers.some(current)
  const drain = () => {
    if (running) return
    const job = queue.shift()
    if (!job) return
    if (!alive(job)) { job.resolve({ cancelled: true }); drain(); return }
    running = job
    Promise.resolve().then(() => job.run(() => alive(job))).then(job.resolve, job.reject).finally(() => {
      running = null
      drain()
    })
  }
  return {
    run(key, caller, run) {
      const matching = [running, ...queue].find(job => job && job.key === key && alive(job))
      if (matching) { matching.callers.push(caller); return matching.promise }
      const job = { key, callers: [caller], run }
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