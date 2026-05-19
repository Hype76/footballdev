import { useEffect, useMemo, useState } from 'react'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import { getParentPortalPolls, submitParentPortalPollVote } from '../lib/supabase.js'

function getPollVoteCounts(poll) {
  const counts = new Map()

  poll.options.forEach((option) => counts.set(option.id, 0))
  ;(poll.votes ?? []).forEach((vote) => {
    if (vote.optionId) {
      counts.set(vote.optionId, Number(vote.count ?? 0))
    }
  })

  return counts
}

function getTotalVotes(poll) {
  const counts = getPollVoteCounts(poll)
  return [...counts.values()].reduce((total, count) => total + Number(count ?? 0), 0)
}

function getSelectedOptionIds(poll) {
  if (Array.isArray(poll.currentOptionIds) && poll.currentOptionIds.length > 0) {
    return poll.currentOptionIds
  }

  return poll.currentOptionId ? [poll.currentOptionId] : []
}

export function ParentPollsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const links = useMemo(() => (Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []), [user?.parentPortalLinks])
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [polls, setPolls] = useState([])
  const [isLoadingPolls, setIsLoadingPolls] = useState(false)
  const [activePollId, setActivePollId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const selectedLink = useMemo(
    () =>
      links.find((link) => link.id === selectedLinkId)
      ?? links.find((link) => link.id === user?.selectedParentLinkId)
      ?? links[0],
    [links, selectedLinkId, user?.selectedParentLinkId],
  )

  async function loadPolls() {
    if (!selectedLink?.id) {
      setPolls([])
      return
    }

    const nextPolls = await getParentPortalPolls({ parentLinkId: selectedLink.id })
    setPolls(nextPolls)
  }

  useEffect(() => {
    let isCurrent = true

    async function runLoad() {
      if (!selectedLink?.id) {
        setPolls([])
        return
      }

      setIsLoadingPolls(true)
      setErrorMessage('')

      try {
        const nextPolls = await getParentPortalPolls({ parentLinkId: selectedLink.id })

        if (isCurrent) {
          setPolls(nextPolls)
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          setPolls([])
          setErrorMessage(error.message || 'Polls could not be loaded.')
        }
      } finally {
        if (isCurrent) {
          setIsLoadingPolls(false)
        }
      }
    }

    void runLoad()

    return () => {
      isCurrent = false
    }
  }, [selectedLink?.id])

  const handleVote = async (poll, optionId) => {
    if (!selectedLink?.id) {
      return
    }

    setActivePollId(poll.id)
    setErrorMessage('')

    try {
      await submitParentPortalPollVote({
        parentLinkId: selectedLink.id,
        pollId: poll.id,
        optionId,
      })
      await loadPolls()
      showToast({ title: 'Vote saved', message: 'Your poll answer has been saved.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Vote could not be saved.')
    } finally {
      setActivePollId('')
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Parent Portal"
        title="Polls"
        description="Answer quick polls shared by the club for your linked child."
      />

      <SectionCard title="Polls" description="Select a child, then choose an answer for each open poll.">
        {links.length > 1 ? (
          <div className="mb-4">
            <label htmlFor="parent-poll-child" className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
              Child
            </label>
            <select
              id="parent-poll-child"
              value={selectedLink?.id || ''}
              onChange={(event) => setSelectedLinkId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {links.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.playerName} | {link.teamName || 'No team'} | {link.clubName || 'No club'}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {errorMessage ? (
          <NoticeBanner title="Poll action failed" message={errorMessage} />
        ) : isLoadingPolls ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading polls...
          </p>
        ) : polls.length > 0 ? (
          <div className="space-y-4">
            {polls.map((poll) => (
              <ParentPollCard
                key={poll.id}
                activePollId={activePollId}
                onVote={handleVote}
                poll={poll}
                selectedLink={selectedLink}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No parent polls are open for this child right now.
          </p>
        )}
      </SectionCard>
    </div>
  )
}

function ParentPollCard({ activePollId, onVote, poll, selectedLink }) {
  const counts = getPollVoteCounts(poll)
  const totalVotes = getTotalVotes(poll)
  const selectedOptionIds = getSelectedOptionIds(poll)
  const hasVoted = selectedOptionIds.length > 0
  const isBusy = activePollId === poll.id
  const isVoteLocked = hasVoted && poll.allowVoteChanges === false
  const shouldShowVotes = !poll.hideVotes || hasVoted
  const selectedPlayerId = String(selectedLink?.playerId ?? '').trim()

  return (
    <article className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
            {poll.pollType === 'time' ? 'Time poll' : poll.pollType === 'awards' ? 'Awards poll' : 'Text poll'}
          </span>
          {poll.allowMultiple ? (
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {poll.maxChoices ? `Choose up to ${poll.maxChoices}` : 'Choose more than one'}
            </span>
          ) : null}
          {poll.allowOwnChildVotes === false ? (
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              Own child not available
            </span>
          ) : null}
          {poll.allowVoteChanges === false ? (
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              Vote locked after choice
            </span>
          ) : null}
        </div>
        <h4 className="text-lg font-semibold text-[var(--text-primary)]">{poll.title}</h4>
        {poll.description ? <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-muted)]">{poll.description}</p> : null}
        <p className="text-xs text-[var(--text-muted)]">
          {isVoteLocked ? 'Your answer has been saved and cannot be changed.' : hasVoted ? 'Your answer has been saved. You can change it while the poll is open.' : poll.allowMultiple && poll.maxChoices ? `Choose up to ${poll.maxChoices} answers.` : poll.allowMultiple ? 'Choose one or more answers.' : 'Choose one answer.'}
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {poll.options.map((option) => {
          const count = Number(counts.get(option.id) ?? 0)
          const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
          const isSelected = selectedOptionIds.includes(option.id)
          const isOwnChildOption = poll.allowOwnChildVotes === false
            && selectedPlayerId
            && String(option.playerId ?? '').trim() === selectedPlayerId
          const isDisabled = isBusy || isVoteLocked || isOwnChildOption

          return (
            <div
              key={option.id}
              className={`rounded-lg border p-3 ${
                isOwnChildOption
                  ? 'border-[var(--border-color)] bg-[var(--panel-soft)] opacity-60'
                  : 'border-[var(--border-color)] bg-[var(--panel-bg)]'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{option.label}</p>
                  {isOwnChildOption ? (
                    <p className="mt-1 text-xs font-semibold text-[var(--text-secondary)]">Own child not available for this poll</p>
                  ) : null}
                  {shouldShowVotes ? (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{count} votes | {percent}%</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onVote(poll, option.id)}
                  disabled={isDisabled}
                  className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isSelected
                      ? 'border border-[var(--accent)] bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                      : 'border border-[var(--border-color)] bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
                  }`}
                >
                  {isOwnChildOption ? 'Unavailable' : isVoteLocked && isSelected ? 'Locked' : isSelected ? 'Selected' : 'Vote'}
                </button>
              </div>
              {shouldShowVotes ? (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel-alt)]">
                  <div className="h-full rounded-full bg-[var(--button-primary)]" style={{ width: `${percent}%` }} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </article>
  )
}
