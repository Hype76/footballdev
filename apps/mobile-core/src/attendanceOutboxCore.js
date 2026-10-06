const routes = new Set(['parent_match', 'parent_training', 'coach_player_match', 'coach_player_training', 'coach_self_training'])
const active = new Set(['persisting', 'pending', 'sending', 'retryable'])
const copy = value => JSON.parse(JSON.stringify(value))
const stable = value => JSON.stringify(value, Object.keys(value).sort())

export function attendanceTargetKey(preparation) {
  return preparation ? `${preparation.route}:${stable(preparation.target)}` : ''
}

export function createAttendanceCommand({ id, scope, preparation, response, label = 'Attendance', now = Date.now() }) {
  if (!id || !scope || !routes.has(preparation?.route) || !preparation.target
    || preparation.baseline?.revision == null || !/^\d+$/.test(String(preparation.baseline.revision))
    || !Number.isSafeInteger(Number(preparation.baseline.revision)) || Number(preparation.baseline.revision) < 0
    || !['pending', 'available', 'unavailable', 'maybe'].includes(preparation.baseline.status)
    || !Object.prototype.hasOwnProperty.call(preparation.baseline, 'respondedAt')
    || (preparation.baseline.respondedAt !== null && !Number.isFinite(Date.parse(preparation.baseline.respondedAt)))
    || !['available', 'unavailable', 'maybe'].includes(response)
    || (!preparation.route.startsWith('parent_') && response === 'maybe')) throw new Error('Refresh this attendance request before choosing an answer.')
  return { id, scope, preparation: copy(preparation), targetKey: attendanceTargetKey(preparation), response,
    label, status: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: now, error: '', notifyPending: false }
}

export function appendAttendanceCommand(commands, command) {
  const scoped = commands.filter(entry => entry.scope === command.scope)
  if (scoped.some(entry => entry.targetKey === command.targetKey && (active.has(entry.status) || ['conflict', 'rejected'].includes(entry.status)))) {
    throw new Error('This answer is already pending. Check its saved status first.')
  }
  if (commands.some(entry => entry.id === command.id)) throw new Error('This saved command already exists.')
  if (commands.filter(entry => active.has(entry.status) || entry.notifyPending).length >= 200) throw new Error('Sync saved attendance answers before adding more.')
  return [...commands.filter(entry => !(entry.scope === command.scope && entry.targetKey === command.targetKey && !entry.notifyPending)), command]
}

export function projectAttendanceChoice(item, commands, scope) {
  const preparation = item?.attendancePreparation
  // Preparation is read after resource rows and carries the authoritative answer.
  // Reconcile the displayed row to that baseline before applying a local choice.
  if (preparation?.baseline) item = { ...item, responseState: preparation.baseline.status,
    status: preparation.baseline.status, lastRespondedAt: preparation.baseline.respondedAt,
    respondedAt: preparation.baseline.respondedAt }
  const key = attendanceTargetKey(preparation)
  const matching = commands.filter(entry => entry.scope === scope && entry.targetKey === key)
  const command = [...matching].reverse().find(entry => active.has(entry.status) || ['conflict', 'rejected'].includes(entry.status))
    || matching.filter(entry => entry.status === 'saved').reduce((latest, entry) =>
      !latest || Number(entry.receipt?.current?.revision ?? -1) >= Number(latest.receipt?.current?.revision ?? -1) ? entry : latest, null)
  if (!command) return item
  if (command.status === 'saved') {
    const confirmed = command.receipt?.current
    if (!confirmed || Number(preparation.baseline.revision) >= Number(confirmed.revision)) return item
    return { ...item, responseState: confirmed.status, status: confirmed.status, lastRespondedAt: confirmed.respondedAt,
      respondedAt: confirmed.respondedAt, attendanceSaved: true,
      attendancePreparation: { ...preparation, baseline: confirmed } }
  }
  const newer = Number(preparation.baseline.revision) > Number(command.preparation.baseline.revision)
  const needsReview = ['conflict', 'rejected'].includes(command.status)
  const reviewed = command.receipt?.current
  if (needsReview && reviewed && Number(reviewed.revision) >= Number(preparation.baseline.revision)) {
    item = { ...item, responseState: reviewed.status, status: reviewed.status,
      lastRespondedAt: reviewed.respondedAt, respondedAt: reviewed.respondedAt }
  }
  return { ...item, ...(newer || needsReview ? {} : { responseState: command.response, status: command.response }),
    attendancePending: true, attendancePendingStatus: command.status,
    attendancePendingError: command.error, attendanceCommandId: command.id }
}

// Storage supplies encrypted, serialized updates and checks the account/authority epoch.
// An accepted receipt means that the command is durable, never that it reached the server.
export function createAttendanceOutbox({ scope, read, update, execute, notify, canSend, isCurrent, onChange = () => {}, onReaction = () => {}, makeId, now = Date.now }) {
  let syncPromise = null
  const accepting = new Set()
  const publish = commands => { if (isCurrent()) onChange(commands.filter(entry => entry.scope === scope)) }
  const change = async updater => {
    if (!isCurrent()) throw new Error('The attendance account changed. Reopen the original workspace.')
    const commands = await update(updater)
    publish(commands)
    return commands
  }
  const patch = (id, values) => change(commands => commands.map(entry => entry.id === id && entry.scope === scope ? { ...entry, ...values } : entry))
  async function recover() {
    const commands = await read()
    publish(commands)
    return commands.filter(entry => entry.scope === scope)
  }
  async function enqueue(preparation, response, label) {
    const key = attendanceTargetKey(preparation)
    if (accepting.has(key)) throw new Error('This answer is being saved on this phone.')
    accepting.add(key)
    try {
      const command = createAttendanceCommand({ id: makeId(), scope, preparation, response, label, now: now() })
      // Visible reaction precedes storage/network awaits. Closure still requires the durable receipt.
      if (isCurrent()) onReaction({ ...command, status: 'persisting' })
      await change(commands => appendAttendanceCommand(commands, command))
      if (isCurrent()) void sync().catch(() => {})
      return command
    } finally { accepting.delete(key) }
  }
  async function run({ explicitRetry = false } = {}) {
    if (!isCurrent() || !canSend()) return recover()
    const commands = await recover()
    for (const command of commands) {
      if (!isCurrent() || !canSend()) break
      if (!active.has(command.status) && !command.notifyPending) continue
      if (!explicitRetry && (command.attempts >= 5 || command.nextAttemptAt > now())) continue
      try {
        let receipt = command.receipt
        if (active.has(command.status)) {
          await patch(command.id, { status: 'sending', attempts: command.attempts + 1, error: '' })
          if (!isCurrent() || !canSend()) break
          receipt = await execute(command)
          if (!['saved', 'conflict'].includes(receipt?.outcome) || !receipt.current) throw new Error('The server did not confirm this saved command.')
          const notifyPending = receipt.outcome === 'saved' && command.preparation.route === 'parent_training'
            && receipt.result?.changed === true && Boolean(receipt.result.respondedAt)
          await patch(command.id, { status: receipt.outcome, receipt, notifyPending, error: receipt.outcome === 'conflict'
            ? 'A newer answer or changed invitation was found. Refresh and review before choosing again.' : '', nextAttemptAt: 0 })
          if (receipt.outcome === 'conflict') continue
        }
        if (receipt?.outcome === 'saved' && command.preparation.route === 'parent_training' && receipt.result?.changed === true && receipt.result.respondedAt) {
          if (!isCurrent() || !canSend()) break
          if (!notify || await notify(command, receipt) !== true) throw new Error('Your answer is saved. Coach notification will retry when connected.')
          await patch(command.id, { notifyPending: false, error: '', nextAttemptAt: 0 })
        }
      } catch (error) {
        if (!isCurrent()) break
        const current = (await read()).find(entry => entry.id === command.id && entry.scope === scope)
        if (!current) continue
        const committed = current.status === 'saved'
        const permanent = !committed && ['42501', 'P0001', '22023'].includes(error?.code)
        await patch(command.id, { status: committed ? 'saved' : permanent ? 'rejected' : 'retryable',
          error: committed ? 'Your answer is saved. Coach notification needs retry.' : permanent
            ? 'This invitation or your access changed. Refresh and review this answer.'
            : 'This answer is saved on this phone but could not be confirmed. Retry when connected.',
          attempts: Math.max(current.attempts || 0, command.attempts + 1),
          nextAttemptAt: now() + Math.min(60000, 1000 * (2 ** Math.min(command.attempts, 6))) })
      }
    }
    return recover()
  }
  function sync(options) {
    if (syncPromise) return syncPromise
    syncPromise = run(options).finally(() => { syncPromise = null })
    return syncPromise
  }
  async function review(id) {
    return change(commands => commands.filter(entry => !(entry.id === id && entry.scope === scope && ['conflict', 'rejected'].includes(entry.status))))
  }
  return { enqueue, recover, review, sync }
}
