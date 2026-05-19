import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManagePolls, useAuth } from '../lib/auth.js'
import {
  createPoll,
  deletePoll,
  getPolls,
  getTeams,
  POLL_AUDIENCE_OPTIONS,
  submitStaffPollVote,
  updatePollStatus,
  withRequestTimeout,
} from '../lib/supabase.js'

const EMPTY_FORM = {
  title: '',
  description: '',
  audience: 'parents',
  teamId: '',
  closesAt: '',
  options: ['Yes', 'No'],
}

function getPollVoteCounts(poll) {
  const counts = new Map()

  poll.options.forEach((option) => counts.set(option.id, 0))
  ;(poll.votes ?? []).forEach((vote) => {
    if (vote.optionId) {
      counts.set(vote.optionId, Number(counts.get(vote.optionId) ?? 0) + Number(vote.count ?? 1))
    }
  })

  return counts
}

function getTotalVotes(poll) {
  const counts = getPollVoteCounts(poll)
  return [...counts.values()].reduce((total, count) => total + Number(count ?? 0), 0)
}

function getOwnVote(poll, user) {
  const userEmail = String(user?.email ?? '').trim().toLowerCase()
  return (poll.votes ?? []).find((vote) => {
    if (vote.authUserId && user?.id && String(vote.authUserId) === String(user.id)) {
      return true
    }

    return userEmail && String(vote.voterEmail ?? '').trim().toLowerCase() === userEmail
  })
}

export function PollsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [polls, setPolls] = useState([])
  const [teams, setTeams] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [audienceFilter, setAudienceFilter] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [activePollId, setActivePollId] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const visiblePolls = useMemo(() => {
    if (audienceFilter === 'all') {
      return polls
    }

    return polls.filter((poll) => poll.audience === audienceFilter)
  }, [audienceFilter, polls])

  async function loadPolls() {
    const [nextPolls, nextTeams] = await Promise.all([
      withRequestTimeout(() => getPolls({ user }), 'Polls could not be loaded.'),
      withRequestTimeout(() => getTeams(user), 'Teams could not be loaded.'),
    ])

    setPolls(nextPolls)
    setTeams(nextTeams)
  }

  useEffect(() => {
    let isMounted = true

    async function runLoad() {
      if (!canManagePolls(user)) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const [nextPolls, nextTeams] = await Promise.all([
          withRequestTimeout(() => getPolls({ user }), 'Polls could not be loaded.'),
          withRequestTimeout(() => getTeams(user), 'Teams could not be loaded.'),
        ])

        if (isMounted) {
          setPolls(nextPolls)
          setTeams(nextTeams)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'Polls could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void runLoad()

    return () => {
      isMounted = false
    }
  }, [user])

  if (!canManagePolls(user)) {
    return <Navigate to="/" replace />
  }

  const handleFormChange = (field, value) => {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleOptionChange = (index, value) => {
    setForm((currentForm) => ({
      ...currentForm,
      options: currentForm.options.map((option, optionIndex) => (optionIndex === index ? value : option)),
    }))
  }

  const addOption = () => {
    setForm((currentForm) => ({
      ...currentForm,
      options: [...currentForm.options, ''],
    }))
  }

  const removeOption = (index) => {
    setForm((currentForm) => ({
      ...currentForm,
      options: currentForm.options.filter((_, optionIndex) => optionIndex !== index),
    }))
  }

  const handleCreatePoll = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await createPoll({ user, poll: form })
      setForm(EMPTY_FORM)
      await loadPolls()
      setSuccessMessage('Poll created.')
      showToast({ title: 'Poll created', message: 'The poll is now available to the selected audience.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Poll could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleVote = async (poll, optionId) => {
    setActivePollId(poll.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await submitStaffPollVote({ user, poll, optionId })
      await loadPolls()
      showToast({ title: 'Vote saved', message: 'Your poll vote has been saved.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Vote could not be saved.')
    } finally {
      setActivePollId('')
    }
  }

  const handleStatusChange = async (poll, status) => {
    setActivePollId(poll.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await updatePollStatus({ user, pollId: poll.id, status })
      await loadPolls()
      showToast({ title: 'Poll updated', message: status === 'closed' ? 'The poll has been closed.' : 'The poll has been reopened.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Poll could not be updated.')
    } finally {
      setActivePollId('')
    }
  }

  const handleDeletePoll = async (poll) => {
    const confirmed = window.confirm(`Delete poll "${poll.title}"?`)

    if (!confirmed) {
      return
    }

    setActivePollId(poll.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await deletePoll({ user, pollId: poll.id })
      await loadPolls()
      showToast({ title: 'Poll deleted', message: 'The poll has been removed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Poll could not be deleted.')
    } finally {
      setActivePollId('')
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Polls"
        title="Polls"
        description="Create a quick poll for parent portal users or team staff, then track replies in one place."
      />

      {successMessage ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? <NoticeBanner title="Poll action failed" message={errorMessage} /> : null}

      <SectionCard title="Create poll" description="Choose who should answer this poll, add options, and publish it.">
        <form className="space-y-4" onSubmit={handleCreatePoll}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Poll title</span>
              <input
                value={form.title}
                onChange={(event) => handleFormChange('title', event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
                placeholder="Example: Can you attend Saturday?"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Audience</span>
              <select
                value={form.audience}
                onChange={(event) => handleFormChange('audience', event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                {POLL_AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
              <select
                value={form.teamId}
                onChange={(event) => handleFormChange('teamId', event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <option value="">All teams in this club</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Close date</span>
              <input
                type="datetime-local"
                value={form.closesAt}
                onChange={(event) => handleFormChange('closesAt', event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Description</span>
            <textarea
              value={form.description}
              onChange={(event) => handleFormChange('description', event.target.value)}
              className="min-h-24 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              placeholder="Add any detail people need before answering."
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Options</p>
              <button
                type="button"
                onClick={addOption}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
              >
                Add option
              </button>
            </div>
            <div className="space-y-3">
              {form.options.map((option, index) => (
                <div key={`option-${index}`} className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={option}
                    onChange={(event) => handleOptionChange(index, event.target.value)}
                    className="min-h-11 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    placeholder={`Option ${index + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    disabled={form.options.length <= 2}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? 'Creating...' : 'Create poll'}
          </button>
        </form>
      </SectionCard>

      <SectionCard
        title="Poll board"
        description="Review active and closed polls, answer staff polls, and see response totals."
        actions={(
          <select
            value={audienceFilter}
            onChange={(event) => setAudienceFilter(event.target.value)}
            className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="all">All polls</option>
            <option value="parents">Parent polls</option>
            <option value="staff">Team staff polls</option>
          </select>
        )}
      >
        {isLoading ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading polls...
          </p>
        ) : visiblePolls.length > 0 ? (
          <div className="space-y-4">
            {visiblePolls.map((poll) => (
              <PollCard
                key={poll.id}
                activePollId={activePollId}
                canDelete={Number(user?.roleRank ?? 0) >= 50}
                onDeletePoll={handleDeletePoll}
                onStatusChange={handleStatusChange}
                onVote={handleVote}
                poll={poll}
                user={user}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No polls have been created yet.
          </p>
        )}
      </SectionCard>
    </div>
  )
}

function PollCard({ activePollId, canDelete, onDeletePoll, onStatusChange, onVote, poll, user }) {
  const counts = getPollVoteCounts(poll)
  const totalVotes = getTotalVotes(poll)
  const ownVote = getOwnVote(poll, user)
  const isBusy = activePollId === poll.id
  const isStaffPoll = poll.audience === 'staff'
  const isClosed = poll.status === 'closed'

  return (
    <article className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {isStaffPoll ? 'Team staff' : 'Parent portal'}
            </span>
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {isClosed ? 'Closed' : 'Open'}
            </span>
            {poll.teamName ? (
              <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                {poll.teamName}
              </span>
            ) : null}
          </div>
          <h4 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{poll.title}</h4>
          {poll.description ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-muted)]">{poll.description}</p> : null}
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {totalVotes} {totalVotes === 1 ? 'response' : 'responses'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onStatusChange(poll, isClosed ? 'open' : 'closed')}
            disabled={isBusy}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isClosed ? 'Reopen' : 'Close'}
          </button>
          {canDelete ? (
            <button
              type="button"
              onClick={() => onDeletePoll(poll)}
              disabled={isBusy}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {poll.options.map((option) => {
          const count = Number(counts.get(option.id) ?? 0)
          const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
          const isSelected = ownVote?.optionId === option.id

          return (
            <div key={option.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{option.label}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{count} votes | {percent}%</p>
                </div>
                {isStaffPoll && !isClosed ? (
                  <button
                    type="button"
                    onClick={() => onVote(poll, option.id)}
                    disabled={isBusy}
                    className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isSelected
                        ? 'border border-[var(--accent)] bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                        : 'border border-[var(--border-color)] bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
                    }`}
                  >
                    {isSelected ? 'Selected' : 'Vote'}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel-alt)]">
                <div className="h-full rounded-full bg-[var(--button-primary)]" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </article>
  )
}
