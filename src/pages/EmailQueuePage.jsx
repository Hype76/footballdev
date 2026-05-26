import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { ScheduleDateTimePicker } from '../components/ui/ScheduleDateTimePicker.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageEmailQueue, useAuth } from '../lib/auth.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  deleteScheduledEmail,
  getScheduledEmails,
  sendScheduledEmailNow,
  updateScheduledEmail,
} from '../lib/domain/scheduled-emails.js'

function toDateTimeLocal(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function formatDateTime(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'No date set'
  }

  return date.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function createEditDraft(item) {
  return {
    id: item?.id || '',
    toEmail: item?.toEmail || '',
    subject: item?.subject || '',
    html: item?.html || '',
    scheduledAt: toDateTimeLocal(item?.scheduledAt),
  }
}

const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const primaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg bg-[#067a46] px-4 py-2 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-4 py-2 text-sm font-black text-[#10231a] transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#f4b6b6] bg-[#fff5f5] px-4 py-2 text-sm font-black text-[#b42318] transition hover:bg-[#fee4e2] disabled:cursor-not-allowed disabled:opacity-60'

const queueRules = [
  {
    label: 'Check failed sends first',
    body: 'A failed parent or player email needs fixing before more messages are sent.',
  },
  {
    label: 'Send time is a decision',
    body: 'Change the schedule if the message should wait until after training or match day.',
  },
  {
    label: 'Delete only before release',
    body: 'Deleting removes the email from the holding queue before it reaches the recipient.',
  },
]

export function EmailQueuePage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [queue, setQueue] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [editingItem, setEditingItem] = useState(null)
  const [editDraft, setEditDraft] = useState(() => createEditDraft(null))
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [sendNowTarget, setSendNowTarget] = useState(null)
  const [busyId, setBusyId] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId}:${user.role}:${user.roleRank}:${user.activeTeamId || ''}` : ''

  const sortedQueue = useMemo(
    () => [...queue].sort((first, second) => new Date(first.scheduledAt).getTime() - new Date(second.scheduledAt).getTime()),
    [queue],
  )
  const failedCount = useMemo(() => sortedQueue.filter((item) => item.lastError).length, [sortedQueue])
  const attachedCount = useMemo(() => sortedQueue.filter((item) => item.hasAttachment).length, [sortedQueue])
  const readyCount = useMemo(() => sortedQueue.filter((item) => !item.lastError).length, [sortedQueue])
  const nextQueuedEmail = sortedQueue[0] || null

  useEffect(() => {
    let isMounted = true

    async function loadQueue() {
      if (!user?.clubId || !hasPlanFeature(user, 'parentEmail')) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')
      setIsLoading(true)

      try {
        const items = await getScheduledEmails({ user })

        if (isMounted) {
          setQueue(items)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'Email queue could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadQueue()

    return () => {
      isMounted = false
    }
  }, [user, userScopeKey])

  if (!canManageEmailQueue(user) || !hasPlanFeature(user, 'parentEmail')) {
    return <Navigate to="/" replace />
  }

  const openEditor = (item) => {
    setEditingItem(item)
    setEditDraft(createEditDraft(item))
    setErrorMessage('')
  }

  const closeEditor = () => {
    setEditingItem(null)
    setEditDraft(createEditDraft(null))
  }

  const saveEdit = async () => {
    if (!editingItem) {
      return
    }

    setBusyId(editingItem.id)
    setErrorMessage('')

    try {
      const scheduledDate = new Date(editDraft.scheduledAt)

      if (!editDraft.scheduledAt || Number.isNaN(scheduledDate.getTime())) {
        throw new Error('Choose a valid scheduled send date and time.')
      }

      const updatedItem = await updateScheduledEmail({
        user,
        item: {
          ...editDraft,
          scheduledAt: scheduledDate.toISOString(),
        },
      })

      setQueue((current) => current.map((item) => (item.id === updatedItem.id ? updatedItem : item)))
      showToast({ title: 'Queued email updated' })
      closeEditor()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Queued email could not be updated.')
    } finally {
      setBusyId('')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return
    }

    setBusyId(deleteTarget.id)
    setErrorMessage('')

    try {
      await deleteScheduledEmail({ user, id: deleteTarget.id })
      setQueue((current) => current.filter((item) => item.id !== deleteTarget.id))
      showToast({ title: 'Queued email deleted' })
      setDeleteTarget(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Queued email could not be deleted.')
    } finally {
      setBusyId('')
    }
  }

  const confirmSendNow = async () => {
    if (!sendNowTarget) {
      return
    }

    setBusyId(sendNowTarget.id)
    setErrorMessage('')

    try {
      await sendScheduledEmailNow({ user, id: sendNowTarget.id })
      setQueue((current) => current.filter((item) => item.id !== sendNowTarget.id))
      showToast({ title: 'Queued email sent' })
      setSendNowTarget(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Queued email could not be sent.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#bfe8cd] bg-white shadow-sm shadow-[#d7eadf]/80">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Communication queue</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-5xl">
              Hold parent and player emails until they are ready to leave.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475467]">
              Review scheduled football messages before send time. Fix failures, change timing, send now, or delete a message before it reaches families.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {queueRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
                  <p className="text-sm font-black text-[#10231a]">{rule.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#9addb4] bg-[#effbf3] p-5 shadow-sm shadow-[#d7eadf]/80">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Next send</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
                {nextQueuedEmail ? formatDateTime(nextQueuedEmail.scheduledAt) : 'Nothing queued'}
              </p>
              <p className="mt-2 break-words text-sm font-semibold leading-6 text-[#456653]">
                {nextQueuedEmail ? nextQueuedEmail.subject : 'Scheduled parent and player emails will appear here before they are sent.'}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <QueueMetric label="Scheduled" value={sortedQueue.length} />
              <QueueMetric label="Ready" value={readyCount} />
              <QueueMetric label="With PDFs" value={attachedCount} />
              <QueueMetric label="Failed" value={failedCount} tone={failedCount > 0 ? 'danger' : 'default'} />
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Email queue action failed" message={errorMessage} /> : null}

      <div className="rounded-lg border border-[#bfe8cd] bg-white p-4 shadow-sm shadow-[#d7eadf]/80 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 border-b border-[#d7eadf] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Holding queue</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Scheduled messages</h2>
          </div>
          <p className="text-sm font-semibold leading-6 text-[#5f7468]">
            {sortedQueue.length} emails waiting for club approval or send time.
          </p>
        </div>
        {isLoading ? (
          <p className="rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-5 text-sm font-semibold text-[#5f7468]">Loading email queue...</p>
        ) : sortedQueue.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-5 py-8">
            <p className="text-lg font-black text-[#101828]">No emails are waiting to send.</p>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-[#5f7468]">
              Queue items appear after a coach schedules a parent or player email from a football workflow.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedQueue.map((item) => (
              <div key={item.id} className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-4 shadow-sm shadow-[#d7eadf]/60">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg border border-[#b7efce] bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#067a46]">
                        {item.status}
                      </span>
                      {item.hasAttachment ? (
                        <span className="rounded-lg border border-[#bfe8cd] bg-white px-3 py-1 text-xs font-black text-[#5f7468]">
                          PDF attached
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 break-words text-lg font-black text-[#101828]">{item.subject}</h2>
                    <p className="mt-2 break-words text-sm font-semibold leading-6 text-[#5f7468]">To: {item.toEmail}</p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-[#5f7468]">Send time: {formatDateTime(item.scheduledAt)}</p>
                    {item.playerName ? <p className="mt-1 text-sm font-semibold leading-6 text-[#5f7468]">Player: {item.playerName}</p> : null}
                    {item.lastError ? <p className="mt-2 rounded-lg border border-[#f4b6b6] bg-[#fff5f5] px-3 py-2 text-sm font-black text-[#b42318]">{item.lastError}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => openEditor(item)}
                      disabled={Boolean(busyId)}
                      className={secondaryButtonClass}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendNowTarget(item)}
                      disabled={Boolean(busyId)}
                      className={primaryButtonClass}
                    >
                      Send now
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      disabled={Boolean(busyId)}
                      className={dangerButtonClass}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(editingItem)}
        isBusy={busyId === editingItem?.id}
        title="Queued email"
        message="Review and edit this email before its scheduled send time."
        confirmLabel="Save changes"
        confirmDisabled={!editDraft.toEmail || !editDraft.subject || !editDraft.scheduledAt}
        onCancel={closeEditor}
        onClose={closeEditor}
        onConfirm={() => void saveEdit()}
      >
        <div className="space-y-4">
          <label className="block">
            <span className={labelClass}>Recipients</span>
            <input
              value={editDraft.toEmail}
              onChange={(event) => setEditDraft((current) => ({ ...current, toEmail: event.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Subject</span>
            <input
              value={editDraft.subject}
              onChange={(event) => setEditDraft((current) => ({ ...current, subject: event.target.value }))}
              className={inputClass}
            />
          </label>
          <ScheduleDateTimePicker
            value={editDraft.scheduledAt}
            onChange={(scheduledAt) => setEditDraft((current) => ({ ...current, scheduledAt }))}
          />
          <label className="block">
            <span className={labelClass}>Email HTML</span>
            <textarea
              value={editDraft.html}
              onChange={(event) => setEditDraft((current) => ({ ...current, html: event.target.value }))}
              rows={8}
              className="min-h-40 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 font-mono text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>
          <div className="rounded-lg border border-[#bfe8cd] bg-white p-4 text-black">
            <div dangerouslySetInnerHTML={{ __html: editDraft.html }} />
          </div>
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        isBusy={busyId === deleteTarget?.id}
        title="Delete queued email"
        message="This removes the email from the holding queue and it will not be sent."
        items={[deleteTarget?.subject || 'Queued email', deleteTarget?.toEmail || 'No recipient']}
        confirmLabel="Delete email"
        onCancel={() => setDeleteTarget(null)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmModal
        isOpen={Boolean(sendNowTarget)}
        isBusy={busyId === sendNowTarget?.id}
        title="Send queued email now"
        message="This sends the queued email immediately and removes it from the queue."
        items={[sendNowTarget?.subject || 'Queued email', sendNowTarget?.toEmail || 'No recipient']}
        confirmLabel="Send now"
        onCancel={() => setSendNowTarget(null)}
        onClose={() => setSendNowTarget(null)}
        onConfirm={() => void confirmSendNow()}
      />

      {!hasPlanFeature(user, 'parentEmail') ? (
        <NoticeBanner title="Email queue unavailable" message={createFeatureUpgradeMessage('parentEmail')} tone="info" />
      ) : null}
    </div>
  )
}

function QueueMetric({ label, value, tone = 'default' }) {
  const valueClass = tone === 'danger' ? 'text-[#b42318]' : 'text-[#101828]'

  return (
    <div className="rounded-lg border border-[#bfe8cd] bg-white px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">{label}</p>
      <p className={`mt-2 break-words text-2xl font-black ${valueClass}`}>{value}</p>
    </div>
  )
}
