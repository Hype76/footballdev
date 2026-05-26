import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManagePolls, useAuth } from '../lib/auth.js'
import {
  createPoll,
  deletePoll,
  getPlayers,
  getPolls,
  getTeams,
  POLL_AUDIENCE_OPTIONS,
  POLL_TYPE_OPTIONS,
  submitStaffPollVote,
  updatePollStatus,
  withRequestTimeout,
} from '../lib/supabase.js'

const EMPTY_FORM = {
  title: '',
  description: '',
  audience: 'parents',
  pollType: 'text',
  teamId: '',
  closesAt: '',
  allowMultiple: false,
  maxChoices: '',
  allowOwnChildVotes: true,
  allowVoteChanges: true,
  hideVotes: false,
  allowComments: false,
  options: ['Yes', 'No'],
}

const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-2 text-sm font-black text-[#10231a] transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-2 text-sm font-black text-[#b42318] transition hover:border-[#fda29b] hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10'
const sectionHeaderClass = 'border-b border-[#bddcca] bg-[#f6fbf8] px-5 py-5 sm:px-6'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#067a46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#456653]'
const panelClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 shadow-sm shadow-[#067a46]/10'
const chipClass = 'inline-flex w-fit rounded-lg border border-[#bddcca] bg-white px-3 py-1 text-xs font-black text-[#456653] shadow-sm shadow-[#067a46]/10'

const pollRuleCards = [
  {
    label: 'Audience first',
    body: 'Pick parents or staff before writing the question so replies are sent to the right people.',
  },
  {
    label: 'One decision',
    body: 'Ask for one football answer at a time: available, not available, time choice, or award vote.',
  },
  {
    label: 'Close when done',
    body: 'Close the poll once the team decision is made so parents know the answer is final.',
  },
]

function getOptionId(index) {
  return `option-${index + 1}`
}

function formatDateTimeLabel(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
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

function getOwnOptionIds(poll, user) {
  const userEmail = String(user?.email ?? '').trim().toLowerCase()
  return (poll.votes ?? [])
    .filter((vote) => {
      if (vote.authUserId && user?.id && String(vote.authUserId) === String(user.id)) {
        return true
      }

      return userEmail && String(vote.voterEmail ?? '').trim().toLowerCase() === userEmail
    })
    .map((vote) => vote.optionId)
}

function buildOptionsForSubmit(form) {
  if (form.pollType === 'time') {
    return form.options
      .map((value, index) => ({
        id: getOptionId(index),
        label: formatDateTimeLabel(value),
        value,
      }))
      .filter((option) => option.value && option.label)
  }

  if (form.pollType === 'awards') {
    return form.options
      .map((option, index) => ({
        id: option.id || getOptionId(index),
        label: String(option.label ?? '').trim(),
        playerId: String(option.playerId ?? '').trim(),
      }))
      .filter((option) => option.label)
  }

  return form.options
    .map((label, index) => ({
      id: getOptionId(index),
      label,
    }))
    .filter((option) => String(option.label ?? '').trim())
}

export function PollsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [polls, setPolls] = useState([])
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
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
  const openPollCount = useMemo(() => polls.filter((poll) => poll.status !== 'closed').length, [polls])
  const parentPollCount = useMemo(() => polls.filter((poll) => poll.audience === 'parents').length, [polls])
  const staffPollCount = useMemo(() => polls.filter((poll) => poll.audience === 'staff').length, [polls])
  const closedPollCount = useMemo(() => polls.filter((poll) => poll.status === 'closed').length, [polls])
  const responseCount = useMemo(
    () => polls.reduce((total, poll) => total + getTotalVotes(poll), 0),
    [polls],
  )

  const awardPlayers = useMemo(
    () =>
      players
        .filter((player) => {
          if (form.teamId && String(player.teamId ?? '') !== String(form.teamId)) {
            return false
          }

          return String(player.status ?? 'active') !== 'archived'
        })
        .sort((left, right) => String(left.playerName ?? '').localeCompare(String(right.playerName ?? ''))),
    [form.teamId, players],
  )

  async function loadPolls() {
    const [nextPolls, nextTeams, nextPlayers] = await Promise.all([
      withRequestTimeout(() => getPolls({ user }), 'Polls could not be loaded.'),
      withRequestTimeout(() => getTeams(user), 'Teams could not be loaded.'),
      withRequestTimeout(() => getPlayers({ user }), 'Players could not be loaded.'),
    ])

    setPolls(nextPolls)
    setTeams(nextTeams)
    setPlayers(nextPlayers)
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
        const [nextPolls, nextTeams, nextPlayers] = await Promise.all([
          withRequestTimeout(() => getPolls({ user }), 'Polls could not be loaded.'),
          withRequestTimeout(() => getTeams(user), 'Teams could not be loaded.'),
          withRequestTimeout(() => getPlayers({ user }), 'Players could not be loaded.'),
        ])

        if (isMounted) {
          setPolls(nextPolls)
          setTeams(nextTeams)
          setPlayers(nextPlayers)
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

  const updateForm = (updates) => {
    setForm((currentForm) => ({
      ...currentForm,
      ...updates,
    }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handlePollTypeChange = (pollType) => {
    const nextOptions = pollType === 'awards'
      ? []
      : pollType === 'time'
        ? ['', '']
        : ['Yes', 'No']

    updateForm({
      pollType,
      allowMultiple: pollType === 'time',
      maxChoices: pollType === 'time' ? '' : '',
      options: nextOptions,
    })
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
      options: [...currentForm.options, currentForm.pollType === 'awards' ? { label: '', playerId: '' } : ''],
    }))
  }

  const removeOption = (index) => {
    setForm((currentForm) => ({
      ...currentForm,
      options: currentForm.options.filter((_, optionIndex) => optionIndex !== index),
    }))
  }

  const addSelectedPlayer = () => {
    const player = awardPlayers.find((candidate) => String(candidate.id) === String(selectedPlayerId))

    if (!player) {
      return
    }

    setForm((currentForm) => {
      const existingPlayerIds = new Set(currentForm.options.map((option) => String(option.playerId ?? '')))

      if (existingPlayerIds.has(String(player.id))) {
        return currentForm
      }

      return {
        ...currentForm,
        options: [
          ...currentForm.options,
          {
            id: `player-${player.id}`,
            label: player.playerName,
            playerId: player.id,
          },
        ],
      }
    })
    setSelectedPlayerId('')
  }

  const addAllPlayers = () => {
    setForm((currentForm) => ({
      ...currentForm,
      options: awardPlayers.map((player) => ({
        id: `player-${player.id}`,
        label: player.playerName,
        playerId: player.id,
      })),
    }))
  }

  const handleCreatePoll = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await createPoll({
        user,
        poll: {
          ...form,
          options: buildOptionsForSubmit(form),
        },
      })
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
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-sm shadow-[#067a46]/10">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="px-5 py-6 sm:px-6 lg:px-8">
            <div className="max-w-5xl">
              <p className={eyebrowClass}>Availability control</p>
              <h1 className="mt-3 text-4xl font-black leading-[1.02] tracking-tight text-[#10231a] sm:text-5xl">
                Get the answer before you pick the squad.
              </h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#456653]">
                Use polls as football decisions, not generic surveys. Ask the right people, collect the reply, then close the loop before training or match day.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {pollRuleCards.map((item) => (
                  <article key={item.label} className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 shadow-sm shadow-[#067a46]/10">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="grid content-between border-t border-[#bddcca] bg-[#f0fdf6] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#456653]">Reply state</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">
                {openPollCount} open / {responseCount} replies
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <DecisionMetric label="Parents" value={parentPollCount} isLoading={isLoading} />
              <DecisionMetric label="Staff" value={staffPollCount} isLoading={isLoading} />
              <DecisionMetric label="Closed" value={closedPollCount} isLoading={isLoading} />
              <DecisionMetric label="Visible" value={visiblePolls.length} isLoading={isLoading} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#456653]">
              Keep open polls current. Old decisions should be closed or deleted so the club board stays readable.
            </p>
          </div>
        </div>
      </section>

      {successMessage ? (
        <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 py-3 text-sm font-black text-[#067a46] shadow-sm shadow-[#067a46]/10">
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? <NoticeBanner title="Poll action failed" message={errorMessage} /> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Open decisions', value: openPollCount, caption: 'Still waiting for replies or action.' },
          { label: 'Parent route', value: parentPollCount, caption: 'Questions sent to parent portal.' },
          { label: 'Staff route', value: staffPollCount, caption: 'Internal team staff decisions.' },
          { label: 'Total replies', value: responseCount, caption: 'Responses across all poll types.' },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#bddcca] bg-white p-5 shadow-sm shadow-[#067a46]/10">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">{item.label}</p>
            <p className="mt-2 text-3xl font-black text-[#10231a]">{isLoading ? '...' : item.value}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{item.caption}</p>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-sm">
        <div className={sectionHeaderClass}>
          <p className={eyebrowClass}>Create request</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">Create a football decision</h2>
          <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
            Choose the poll type, configure the options, and publish it to the right football audience.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleCreatePoll}>
          <div className="space-y-4 px-5 py-5 sm:px-6">
          <div>
            <p className={labelClass}>Poll type</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {POLL_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handlePollTypeChange(option.value)}
                  className={`min-h-11 rounded-lg border px-4 py-3 text-sm font-black transition ${
                    form.pollType === option.value
                      ? 'border-[#067a46] bg-[#067a46] text-white shadow-sm shadow-[#b7efce]'
                      : 'border-[#bddcca] bg-white text-[#10231a] shadow-sm shadow-[#067a46]/10 hover:border-[#20a464] hover:bg-[#f0fdf6]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Title</span>
              <input
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
                className={inputClass}
                placeholder={form.pollType === 'awards' ? 'Example: Player of the match' : 'Write a question'}
                required
              />
            </label>

            <label className="block">
              <span className={labelClass}>Audience</span>
              <select
                value={form.audience}
                onChange={(event) => updateForm({ audience: event.target.value })}
                className={inputClass}
              >
                {POLL_AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Team</span>
              <select
                value={form.teamId}
                onChange={(event) => updateForm({ teamId: event.target.value })}
                className={inputClass}
              >
                <option value="">All teams in this club</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Due date</span>
              <input
                type="datetime-local"
                value={form.closesAt}
                onChange={(event) => updateForm({ closesAt: event.target.value })}
                className={inputClass}
              />
            </label>
          </div>

          <label className="block">
            <span className={labelClass}>Description</span>
            <textarea
              value={form.description}
              onChange={(event) => updateForm({ description: event.target.value })}
              className="min-h-24 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
              placeholder="Description optional"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10">
              <input
                type="checkbox"
                checked={form.allowMultiple}
                onChange={(event) => updateForm({
                  allowMultiple: event.target.checked,
                  maxChoices: event.target.checked ? form.maxChoices : '',
                })}
                className="h-4 w-4 accent-[#067a46]"
              />
              Multiple choice
            </label>
            {form.allowMultiple ? (
              <label className="block rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-2 shadow-sm shadow-[#067a46]/10">
                <span className="mb-1 block text-sm font-black text-[#10231a]">Number of choices</span>
                <input
                  type="number"
                  min="1"
                  max={Math.max(buildOptionsForSubmit(form).length, 1)}
                  value={form.maxChoices}
                  onChange={(event) => updateForm({ maxChoices: event.target.value })}
                  className="min-h-9 w-full rounded-lg border border-[#bddcca] bg-white px-3 py-2 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:ring-2 focus:ring-[#d7f8e5]"
                  placeholder="No limit"
                />
              </label>
            ) : null}
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10">
              <input
                type="checkbox"
                checked={form.hideVotes}
                onChange={(event) => updateForm({ hideVotes: event.target.checked })}
                className="h-4 w-4 accent-[#067a46]"
              />
              Hide votes
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10">
              <input
                type="checkbox"
                checked={form.allowComments}
                onChange={(event) => updateForm({ allowComments: event.target.checked })}
                className="h-4 w-4 accent-[#067a46]"
              />
              Allow comments
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10">
              <input
                type="checkbox"
                checked={form.allowVoteChanges}
                onChange={(event) => updateForm({ allowVoteChanges: event.target.checked })}
                className="h-4 w-4 accent-[#067a46]"
              />
              Allow choice change
            </label>
            {form.audience === 'parents' ? (
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10">
                <input
                  type="checkbox"
                  checked={form.allowOwnChildVotes}
                  onChange={(event) => updateForm({ allowOwnChildVotes: event.target.checked })}
                  className="h-4 w-4 accent-[#067a46]"
                />
                Allow vote for own child
              </label>
            ) : null}
          </div>

          <PollOptionsEditor
            addAllPlayers={addAllPlayers}
            addOption={addOption}
            addSelectedPlayer={addSelectedPlayer}
            awardPlayers={awardPlayers}
            form={form}
            onOptionChange={handleOptionChange}
            onRemoveOption={removeOption}
            selectedPlayerId={selectedPlayerId}
            setSelectedPlayerId={setSelectedPlayerId}
          />

          <button
            type="submit"
            disabled={isSaving}
            className={`${primaryButtonClass} w-full sm:w-auto`}
          >
            {isSaving ? 'Creating...' : 'Create poll'}
          </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-sm">
        <div className="grid gap-4 border-b border-[#bddcca] bg-[#f6fbf8] px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className={eyebrowClass}>Decision board</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">Poll board</h2>
            <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
              Review active and closed polls, answer staff polls, and see response totals.
            </p>
          </div>
          <select
            value={audienceFilter}
            onChange={(event) => setAudienceFilter(event.target.value)}
            className="min-h-10 rounded-lg border border-[#bddcca] bg-white px-3 py-2 text-sm font-black text-[#10231a] outline-none transition focus:border-[#20a464] focus:ring-2 focus:ring-[#d7f8e5]"
          >
            <option value="all">All polls</option>
            <option value="parents">Parent polls</option>
            <option value="staff">Team staff polls</option>
          </select>
        </div>
        <div className="px-5 py-5 sm:px-6">
        {isLoading ? (
          <p className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
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
          <p className={emptyStateClass}>
            No polls have been created yet.
          </p>
        )}
        </div>
      </section>
    </div>
  )
}

function DecisionMetric({ isLoading, label, value }) {
  return (
    <div className="rounded-lg border border-[#bddcca] bg-white px-3 py-3 shadow-sm shadow-[#067a46]/10">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#067a46]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#10231a]">{isLoading ? '...' : value}</p>
    </div>
  )
}

function PollOptionsEditor({
  addAllPlayers,
  addOption,
  addSelectedPlayer,
  awardPlayers,
  form,
  onOptionChange,
  onRemoveOption,
  selectedPlayerId,
  setSelectedPlayerId,
}) {
  if (form.pollType === 'awards') {
    return (
      <div>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-black text-[#10231a]">Award candidates</p>
          <button
            type="button"
            onClick={addAllPlayers}
            disabled={awardPlayers.length === 0}
            className={secondaryButtonClass}
          >
            Add all players
          </button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={selectedPlayerId}
            onChange={(event) => setSelectedPlayerId(event.target.value)}
            className="min-h-11 flex-1 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
          >
            <option value="">Select a player</option>
            {awardPlayers.map((player) => (
              <option key={player.id} value={player.id}>
                {player.playerName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addSelectedPlayer}
            disabled={!selectedPlayerId}
            className={`${secondaryButtonClass} min-h-11`}
          >
            Add player
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {form.options.length > 0 ? form.options.map((option, index) => (
            <div key={option.id || `${option.label}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-2 shadow-sm shadow-[#067a46]/10">
              <span className="min-w-0 break-words text-sm font-black text-[#10231a]">{option.label}</span>
              <button
                type="button"
                onClick={() => onRemoveOption(index)}
                className={secondaryButtonClass}
              >
                Remove
              </button>
            </div>
          )) : (
            <p className={emptyStateClass}>
              Add players from the dropdown or use Add all players.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-black text-[#10231a]">{form.pollType === 'time' ? 'Time options' : 'Options'}</p>
        <button
          type="button"
          onClick={addOption}
          className={secondaryButtonClass}
        >
          Add option
        </button>
      </div>
      <div className="space-y-3">
        {form.options.map((option, index) => (
          <div key={`option-${index}`} className="flex flex-col gap-2 sm:flex-row">
            <input
              type={form.pollType === 'time' ? 'datetime-local' : 'text'}
              value={option}
              onChange={(event) => onOptionChange(index, event.target.value)}
              className="min-h-11 flex-1 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
              placeholder={`Option ${index + 1}`}
            />
            <button
              type="button"
              onClick={() => onRemoveOption(index)}
              disabled={form.options.length <= 2}
              className={`${secondaryButtonClass} min-h-11`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function PollCard({ activePollId, canDelete, onDeletePoll, onStatusChange, onVote, poll, user }) {
  const counts = getPollVoteCounts(poll)
  const totalVotes = getTotalVotes(poll)
  const ownOptionIds = getOwnOptionIds(poll, user)
  const isBusy = activePollId === poll.id
  const isStaffPoll = poll.audience === 'staff'
  const isClosed = poll.status === 'closed'

  return (
    <article className="rounded-lg border border-[#bddcca] bg-white p-5 shadow-sm shadow-[#067a46]/10">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className={chipClass}>
              {isStaffPoll ? 'Team staff' : 'Parent portal'}
            </span>
            <span className={chipClass}>
              {poll.pollType === 'time' ? 'Time poll' : poll.pollType === 'awards' ? 'Awards poll' : 'Text poll'}
            </span>
            {poll.allowMultiple ? (
              <span className={chipClass}>
                {poll.maxChoices ? `Up to ${poll.maxChoices} choices` : 'Multiple choice'}
              </span>
            ) : null}
            {!isStaffPoll && poll.allowOwnChildVotes === false ? (
              <span className={chipClass}>
                Own child blocked
              </span>
            ) : null}
            {poll.allowVoteChanges === false ? (
              <span className={chipClass}>
                Vote locked after choice
              </span>
            ) : null}
            <span className={`inline-flex w-fit rounded-lg border px-3 py-1 text-xs font-black shadow-sm ${isClosed ? 'border-[#bddcca] bg-[#eef8f1] text-[#456653] shadow-[#067a46]/10' : 'border-[#bddcca] bg-[#f0fdf6] text-[#067a46] shadow-[#067a46]/10'}`}>
              {isClosed ? 'Closed' : 'Open'}
            </span>
            {poll.teamName ? (
              <span className={chipClass}>
                {poll.teamName}
              </span>
            ) : null}
          </div>
          <h4 className="mt-3 text-lg font-black text-[#10231a]">{poll.title}</h4>
          {poll.description ? <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#456653]">{poll.description}</p> : null}
          <p className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-[#456653]">
            {totalVotes} {totalVotes === 1 ? 'response' : 'responses'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onStatusChange(poll, isClosed ? 'open' : 'closed')}
            disabled={isBusy}
            className={secondaryButtonClass}
          >
            {isClosed ? 'Reopen' : 'Close poll early'}
          </button>
          {canDelete ? (
            <button
              type="button"
              onClick={() => onDeletePoll(poll)}
              disabled={isBusy}
              className={dangerButtonClass}
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
          const isSelected = ownOptionIds.includes(option.id)

          return (
            <div key={option.id} className={panelClass}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#10231a]">{option.label}</p>
                  <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-[#456653]">{count} votes / {percent}%</p>
                </div>
                {isStaffPoll && !isClosed ? (
                  <button
                    type="button"
                    onClick={() => onVote(poll, option.id)}
                    disabled={isBusy}
                    className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isSelected
                        ? 'border-[#067a46] bg-[#067a46] text-white'
                        : 'border-[#bddcca] bg-white text-[#10231a] hover:border-[#20a464] hover:bg-[#f0fdf6]'
                    }`}
                  >
                    {isSelected ? 'Selected' : 'Vote'}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-lg bg-[#bddcca]">
                <div className="h-full rounded-lg bg-[#20a464]" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </article>
  )
}
