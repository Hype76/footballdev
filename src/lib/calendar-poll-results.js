function normaliseOption(option, index) {
  const id = String(option?.id ?? '').trim()
  const label = String(option?.label ?? '').trim()

  return id && label ? { id, index, label } : null
}

function normaliseVoteCount(value) {
  const count = Number(value ?? 1)
  return Number.isFinite(count) && count > 0 ? count : 0
}

export function isCalendarPollClosed(poll, now = new Date()) {
  if (String(poll?.status ?? '').trim().toLowerCase() === 'closed') {
    return true
  }

  const closesAt = new Date(String(poll?.closesAt ?? poll?.closes_at ?? '').trim())
  return !Number.isNaN(closesAt.getTime()) && closesAt.getTime() <= now.getTime()
}

export function getCalendarPollResults(poll) {
  const options = (Array.isArray(poll?.options) ? poll.options : [])
    .map(normaliseOption)
    .filter(Boolean)
  const countsByOptionId = new Map(options.map((option) => [option.id, 0]))

  ;(Array.isArray(poll?.votes) ? poll.votes : []).forEach((vote) => {
    const optionId = String(vote?.optionId ?? vote?.option_id ?? '').trim()

    if (!countsByOptionId.has(optionId)) {
      return
    }

    countsByOptionId.set(optionId, countsByOptionId.get(optionId) + normaliseVoteCount(vote?.count))
  })

  const rankedOptions = options
    .map((option) => ({ ...option, count: countsByOptionId.get(option.id) ?? 0 }))
    .sort((left, right) => right.count - left.count || left.index - right.index)
  const totalVotes = rankedOptions.reduce((total, option) => total + option.count, 0)
  const leadingCount = rankedOptions[0]?.count ?? 0
  const leaders = totalVotes > 0
    ? rankedOptions.filter((option) => option.count === leadingCount)
    : []

  return { leaders, rankedOptions, totalVotes }
}
