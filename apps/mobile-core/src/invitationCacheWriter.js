export function createInvitationCacheWriter({ isCurrent, onSaved, onFailure }) {
  let pending = null, latest = null, running = null, savedKey = null
  async function drain() {
    while (pending && isCurrent()) {
      const job = pending
      pending = null
      try {
        if (job.key !== savedKey) await job.write(job.snapshot)
        if (!isCurrent()) return
        savedKey = job.key
        if (latest === job) onSaved(job)
      } catch {
        if (isCurrent() && latest === job) onFailure(job)
      }
    }
  }
  function schedule(job) {
    if (!isCurrent()) return Promise.resolve()
    latest = job
    pending = job
    if (!running) running = drain().finally(() => { running = null; if (pending && isCurrent()) void schedule(pending) })
    return running
  }
  return { schedule, retry: () => latest ? schedule(latest) : Promise.resolve() }
}
