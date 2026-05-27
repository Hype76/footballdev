import { useEffect, useMemo, useState } from 'react'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import { getParentPortalPolls, submitParentPortalPollVote } from '../lib/supabase.js'

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#475569]'
const panelClass = 'rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10'
const chipClass = 'inline-flex w-fit whitespace-nowrap rounded-lg border border-[#cbd5e1] bg-white px-3 py-1 text-xs font-black text-[#475569] shadow-sm shadow-[#2563eb]/10'

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
  const answeredPollCount = polls.filter((poll) => getSelectedOptionIds(poll).length > 0).length
  const pollSummary = [
    {
      label: 'Linked children',
      value: links.length,
      caption: 'Children this parent account can view.',
    },
    {
      label: 'Open polls',
      value: polls.length,
      caption: 'Questions shared by the club.',
    },
    {
      label: 'Answered',
      value: answeredPollCount,
      caption: 'Polls where this account has replied.',
    },
  ]

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
      <ParentPollsHero
        answeredPollCount={answeredPollCount}
        isLoading={isLoadingPolls}
        polls={polls}
        selectedLink={selectedLink}
        summary={pollSummary}
      />

      <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
        <div className="grid gap-5 border-b border-[#cbd5e1] bg-white px-5 py-5 sm:px-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <div>
            <p className={eyebrowClass}>Parent polls</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-[#0f172a]">Answer club questions</h2>
            <p className={`mt-2 ${bodyTextClass}`}>
              Select the right child, read the voting rule, then answer only the polls that are open for that link.
            </p>
          </div>

          <div className="rounded-lg border border-[#cbd5e1] bg-[#eff6ff] p-4 shadow-sm shadow-[#2563eb]/10">
            <p className={eyebrowClass}>Poll rule</p>
            <p className={`mt-2 ${bodyTextClass}`}>
              Polls are controlled by the club. Some allow one answer, some allow multiple answers, and some lock your response after voting.
            </p>
          </div>
        </div>

        <div className="grid gap-5 bg-[#f8fafc] px-5 py-5 sm:px-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="space-y-4">
            <ParentPollChildSelector
              links={links}
              onSelect={setSelectedLinkId}
              selectedLink={selectedLink}
            />

            <div className={panelClass}>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#475569]">Selected child</p>
              <p className="mt-2 text-lg font-black text-[#0f172a]">{selectedLink?.playerName || 'No child selected'}</p>
              <p className="mt-1 text-sm font-semibold text-[#475569]">Team: {selectedLink?.teamName || 'No team assigned'}, Club: {selectedLink?.clubName || 'No club assigned'}</p>
            </div>
          </aside>

          <div className="min-w-0">
            {errorMessage ? (
              <NoticeBanner title="Poll action failed" message={errorMessage} />
            ) : isLoadingPolls ? (
              <p className="rounded-lg border border-[#cbd5e1] bg-white px-4 py-5 text-sm font-semibold text-[#475569]">
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
              <p className="rounded-lg border border-[#cbd5e1] bg-white px-4 py-5 text-sm font-semibold text-[#475569]">
                No parent polls are open for this child right now.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function ParentPollsHero({ answeredPollCount, isLoading, polls, selectedLink, summary }) {
  const nextPoll = polls.find((poll) => getSelectedOptionIds(poll).length === 0) ?? polls[0]

  return (
    <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="px-5 py-6 sm:px-6 lg:px-8">
          <div className="max-w-5xl">
            <p className={eyebrowClass}>Family decisions</p>
            <h1 className="mt-3 text-3xl font-black leading-[1.02] tracking-tight text-[#0f172a] sm:text-4xl">
              Polls for {selectedLink?.playerName || 'your child'}.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475569]">
              Answer club questions without searching through chat threads. Each poll shows the voting constraint before you choose.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {summary.map((item) => (
                <ParentPollMetric key={item.label} isLoading={isLoading} {...item} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid content-between border-t border-[#cbd5e1] bg-[#eff6ff] p-5 sm:p-6 xl:border-l xl:border-t-0">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#475569]">Next poll</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-[#0f172a]">
              {nextPoll ? nextPoll.title : 'No open poll'}
            </p>
            <p className={bodyTextClass}>
              {nextPoll ? `${answeredPollCount} answered from ${polls.length} shared polls.` : 'The club has not shared a poll for this child yet.'}
            </p>
          </div>
          <div className="mt-5 rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 shadow-sm shadow-[#2563eb]/10">
            <p className={eyebrowClass}>Next action</p>
            <p className={`mt-1 ${bodyTextClass}`}>
              Read the lock rule before voting. If changes are blocked, the first saved answer is final.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function ParentPollMetric({ caption, isLoading, label, value }) {
  return (
    <article className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">{label}</p>
      <p className="mt-3 text-4xl font-black tracking-tight text-[#0f172a]">{isLoading ? '...' : value}</p>
      <p className={`mt-2 ${bodyTextClass}`}>{caption}</p>
    </article>
  )
}

function ParentPollChildSelector({ links, onSelect, selectedLink }) {
  return (
    <div className={panelClass}>
      <label htmlFor="parent-poll-child" className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-[#475569]">
        Child
      </label>
      <select
        id="parent-poll-child"
        value={selectedLink?.id || ''}
        onChange={(event) => onSelect(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-black text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
      >
        {links.map((link) => (
          <option key={link.id} value={link.id}>
            {link.playerName}, Team: {link.teamName || 'No team assigned'}, Club: {link.clubName || 'No club assigned'}
          </option>
        ))}
      </select>
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
    <article className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <span className={chipClass}>
            {poll.pollType === 'time' ? 'Time poll' : poll.pollType === 'awards' ? 'Awards poll' : 'Text poll'}
          </span>
          {poll.allowMultiple ? (
            <span className={chipClass}>
              {poll.maxChoices ? `Choose up to ${poll.maxChoices}` : 'Choose more than one'}
            </span>
          ) : null}
          {poll.allowOwnChildVotes === false ? (
            <span className={chipClass}>
              Own child not available
            </span>
          ) : null}
          {poll.allowVoteChanges === false ? (
            <span className={chipClass}>
              Vote locked after choice
            </span>
          ) : null}
        </div>
        <h4 className="text-lg font-black text-[#0f172a]">{poll.title}</h4>
        {poll.description ? <p className={`whitespace-pre-wrap ${bodyTextClass}`}>{poll.description}</p> : null}
        <p className="text-xs font-semibold text-[#475569]">
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
                  ? 'border-[#cbd5e1] bg-[#eff6ff] opacity-60'
                  : 'border-[#cbd5e1] bg-[#f8fafc]'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#0f172a]">{option.label}</p>
                  {isOwnChildOption ? (
                    <p className="mt-1 text-xs font-bold text-[#475569]">Own child not available for this poll</p>
                  ) : null}
                  {shouldShowVotes ? <p className="mt-1 text-xs font-semibold text-[#475569]">{count} votes / {percent}%</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => onVote(poll, option.id)}
                  disabled={isDisabled}
                  className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isSelected
                      ? 'border border-[#2563eb] bg-[#2563eb] text-white'
                      : 'border border-[#cbd5e1] bg-white text-[#0f172a] hover:bg-[#f8fafc]'
                  }`}
                >
                  {isOwnChildOption ? 'Unavailable' : isVoteLocked && isSelected ? 'Locked' : isSelected ? 'Selected' : 'Vote'}
                </button>
              </div>
              {shouldShowVotes ? (
                <div className="mt-3 h-2 overflow-hidden rounded-lg bg-[#cbd5e1]">
                  <div className="h-full rounded-lg bg-[#2563eb]" style={{ width: `${percent}%` }} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </article>
  )
}
