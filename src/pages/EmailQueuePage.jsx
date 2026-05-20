import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
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
      <PageHeader
        eyebrow="Coach Mode"
        title="Email queue"
        description="Review scheduled emails before they send. Queued emails can be edited, sent now, or deleted."
      />

      {errorMessage ? <NoticeBanner title="Email queue action failed" message={errorMessage} /> : null}

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:p-5">
        {isLoading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading email queue...</p>
        ) : sortedQueue.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No scheduled emails are waiting to send.</p>
        ) : (
          <div className="space-y-3">
            {sortedQueue.map((item) => (
              <div key={item.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                        {item.status}
                      </span>
                      {item.hasAttachment ? (
                        <span className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
                          PDF attached
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 break-words text-lg font-semibold text-[var(--text-primary)]">{item.subject}</h2>
                    <p className="mt-2 break-words text-sm leading-6 text-[var(--text-muted)]">To: {item.toEmail}</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">Send time: {formatDateTime(item.scheduledAt)}</p>
                    {item.playerName ? <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">Player: {item.playerName}</p> : null}
                    {item.lastError ? <p className="mt-2 text-sm font-semibold text-[var(--danger-text)]">{item.lastError}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => openEditor(item)}
                      disabled={Boolean(busyId)}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendNowTarget(item)}
                      disabled={Boolean(busyId)}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Send Now
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      disabled={Boolean(busyId)}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-2 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
        confirmLabel="Save Changes"
        confirmDisabled={!editDraft.toEmail || !editDraft.subject || !editDraft.scheduledAt}
        onCancel={closeEditor}
        onClose={closeEditor}
        onConfirm={() => void saveEdit()}
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Recipients</span>
            <input
              value={editDraft.toEmail}
              onChange={(event) => setEditDraft((current) => ({ ...current, toEmail: event.target.value }))}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Subject</span>
            <input
              value={editDraft.subject}
              onChange={(event) => setEditDraft((current) => ({ ...current, subject: event.target.value }))}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <ScheduleDateTimePicker
            value={editDraft.scheduledAt}
            onChange={(scheduledAt) => setEditDraft((current) => ({ ...current, scheduledAt }))}
          />
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email HTML</span>
            <textarea
              value={editDraft.html}
              onChange={(event) => setEditDraft((current) => ({ ...current, html: event.target.value }))}
              rows={8}
              className="min-h-40 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 font-mono text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <div className="rounded-lg border border-[var(--border-color)] bg-white p-4 text-black">
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
        confirmLabel="Delete Email"
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
        confirmLabel="Send Now"
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
