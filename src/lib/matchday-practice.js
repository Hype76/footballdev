export const PRACTICE_SESSION_VERSION = 1
export const PRACTICE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PRACTICE_STORAGE_PREFIX = 'football-player:practice-match-scoring:v1'

export const PRACTICE_PLAYERS = Object.freeze([
  Object.freeze({ id: 'practice-player-alex', playerName: 'Alex Green', shirtNumber: '7' }),
  Object.freeze({ id: 'practice-player-jordan', playerName: 'Jordan Blue', shirtNumber: '9' }),
  Object.freeze({ id: 'practice-player-sam', playerName: 'Sam Gold', shirtNumber: '11' }),
])

export const PRACTICE_MATCH_TEMPLATE = Object.freeze({
  id: 'practice-match-template-v1',
  teamId: 'practice-team-home',
  teamName: 'Practice Rovers',
  opponent: 'Training United',
  homeAway: 'home',
  kickoffTimeTbc: true,
  matchDurationMinutes: 90,
  isBeforeKickoff: false,
  isScorer: true,
})

function normalizeIdentity(value) {
  return String(value ?? '').trim()
}

function clonePlayers() {
  return PRACTICE_PLAYERS.map((player) => ({ ...player }))
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return `practice-session-${globalThis.crypto.randomUUID()}`
  }

  return `practice-session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function getPracticeStorageKey(parentIdentity) {
  const identity = normalizeIdentity(parentIdentity)
  if (!identity) {
    throw new Error('An authenticated parent identity is required for practice mode.')
  }

  return `${PRACTICE_STORAGE_PREFIX}:${encodeURIComponent(identity)}`
}

export function createPracticeSession({ guideDismissed = false, now = Date.now() } = {}) {
  const createdAt = new Date(now).toISOString()

  return {
    version: PRACTICE_SESSION_VERSION,
    sessionId: createSessionId(),
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(now + PRACTICE_SESSION_TTL_MS).toISOString(),
    guideDismissed: guideDismissed === true,
    match: {
      ...PRACTICE_MATCH_TEMPLATE,
      matchDate: createdAt.slice(0, 10),
      currentMatchPhase: 'pre_match',
      status: 'practice_ready',
      timerStatus: 'not_started',
      timerStartedAt: null,
      timerElapsedSeconds: 0,
      homeScore: 0,
      awayScore: 0,
    },
    players: clonePlayers(),
    events: [],
  }
}

function isPracticeSession(value) {
  const syntheticPlayersById = new Map(PRACTICE_PLAYERS.map((player) => [player.id, player]))
  const hasOnlySyntheticPlayers = Array.isArray(value?.players)
    && value.players.length === PRACTICE_PLAYERS.length
    && value.players.every((player) => {
      const templatePlayer = syntheticPlayersById.get(player?.id)
      return templatePlayer
        && player.playerName === templatePlayer.playerName
        && player.shirtNumber === templatePlayer.shirtNumber
    })
  const hasOnlySyntheticEvents = Array.isArray(value?.events)
    && value.events.every((event) => !event?.playerId || syntheticPlayersById.has(event.playerId))

  return Boolean(
    value
    && value.version === PRACTICE_SESSION_VERSION
    && String(value.sessionId || '').startsWith('practice-session-')
    && value.match?.id === PRACTICE_MATCH_TEMPLATE.id
    && value.match?.teamId === PRACTICE_MATCH_TEMPLATE.teamId
    && value.match?.teamName === PRACTICE_MATCH_TEMPLATE.teamName
    && value.match?.opponent === PRACTICE_MATCH_TEMPLATE.opponent
    && hasOnlySyntheticPlayers
    && hasOnlySyntheticEvents,
  )
}

export function loadPracticeSession(storage, parentIdentity, { now = Date.now() } = {}) {
  const key = getPracticeStorageKey(parentIdentity)
  let storedValue = null

  try {
    storedValue = storage?.getItem?.(key)
  } catch {
    return createPracticeSession({ now })
  }

  if (!storedValue) {
    return createPracticeSession({ now })
  }

  try {
    const parsed = JSON.parse(storedValue)
    const expiresAt = new Date(parsed?.expiresAt || '').getTime()

    if (!isPracticeSession(parsed) || !Number.isFinite(expiresAt) || expiresAt <= now) {
      return createPracticeSession({ now })
    }

    return parsed
  } catch {
    return createPracticeSession({ now })
  }
}

export function savePracticeSession(storage, parentIdentity, session) {
  if (!isPracticeSession(session)) {
    throw new Error('Only an isolated practice session can be saved in practice storage.')
  }

  storage?.setItem?.(getPracticeStorageKey(parentIdentity), JSON.stringify(session))
  return session
}

function withUpdatedAt(session, now, updates) {
  return {
    ...session,
    ...updates,
    updatedAt: new Date(now).toISOString(),
  }
}

function addTimelineEvent(session, event) {
  return [...session.events, {
    id: `practice-event-${session.events.length + 1}`,
    ...event,
  }]
}

export function getPracticeElapsedSeconds(session, now = Date.now()) {
  const savedSeconds = Math.max(0, Number(session?.match?.timerElapsedSeconds) || 0)

  if (session?.match?.timerStatus !== 'running' || !session.match.timerStartedAt) {
    return savedSeconds
  }

  const startedAt = new Date(session.match.timerStartedAt).getTime()
  if (!Number.isFinite(startedAt)) {
    return savedSeconds
  }

  return savedSeconds + Math.max(0, Math.floor((now - startedAt) / 1000))
}

export function startPracticeMatch(session, { now = Date.now() } = {}) {
  if (session.match.currentMatchPhase !== 'pre_match') {
    return session
  }

  const startedAt = new Date(now).toISOString()
  return withUpdatedAt(session, now, {
    match: {
      ...session.match,
      currentMatchPhase: 'first_half',
      status: 'practice_live',
      timerStatus: 'running',
      timerStartedAt: startedAt,
      timerElapsedSeconds: 0,
    },
    events: addTimelineEvent(session, {
      type: 'lifecycle',
      label: 'Practice match started',
      phase: 'first_half',
      occurredAt: startedAt,
    }),
  })
}

export function pausePracticeTimer(session, { now = Date.now() } = {}) {
  if (session.match.timerStatus !== 'running') {
    return session
  }

  const elapsedSeconds = getPracticeElapsedSeconds(session, now)
  const occurredAt = new Date(now).toISOString()
  return withUpdatedAt(session, now, {
    match: {
      ...session.match,
      timerStatus: 'paused',
      timerStartedAt: null,
      timerElapsedSeconds: elapsedSeconds,
    },
    events: addTimelineEvent(session, {
      type: 'timer_paused',
      label: 'Timer paused',
      occurredAt,
    }),
  })
}

export function resumePracticeTimer(session, { now = Date.now() } = {}) {
  if (session.match.timerStatus !== 'paused' || !['first_half', 'second_half'].includes(session.match.currentMatchPhase)) {
    return session
  }

  const occurredAt = new Date(now).toISOString()
  return withUpdatedAt(session, now, {
    match: {
      ...session.match,
      timerStatus: 'running',
      timerStartedAt: occurredAt,
    },
    events: addTimelineEvent(session, {
      type: 'timer_resumed',
      label: 'Timer resumed',
      occurredAt,
    }),
  })
}

export function addPracticeGoal(session, { playerId = '', side = 'team', now = Date.now() } = {}) {
  if (session.match.status !== 'practice_live' || !['first_half', 'second_half'].includes(session.match.currentMatchPhase)) {
    throw new Error('Start or resume the practice match before recording a goal.')
  }

  const normalizedSide = side === 'opponent' ? 'opponent' : 'team'
  const player = normalizedSide === 'team'
    ? session.players.find((candidate) => candidate.id === playerId)
    : null

  if (normalizedSide === 'team' && !player) {
    throw new Error('Choose a synthetic goalscorer for the practice goal.')
  }

  const homeScore = session.match.homeScore + (normalizedSide === 'team' ? 1 : 0)
  const awayScore = session.match.awayScore + (normalizedSide === 'opponent' ? 1 : 0)
  const occurredAt = new Date(now).toISOString()
  const minute = Math.max(1, Math.floor(getPracticeElapsedSeconds(session, now) / 60) + 1)

  return withUpdatedAt(session, now, {
    match: {
      ...session.match,
      homeScore,
      awayScore,
    },
    events: addTimelineEvent(session, {
      type: 'goal',
      side: normalizedSide,
      playerId: player?.id || null,
      playerName: player?.playerName || 'Opposition player',
      minute,
      homeScore,
      awayScore,
      label: normalizedSide === 'team' ? `${player.playerName} scored` : 'Opposition goal',
      occurredAt,
    }),
  })
}

export function advancePracticeMatch(session, { now = Date.now() } = {}) {
  const phase = session.match.currentMatchPhase
  const occurredAt = new Date(now).toISOString()
  const elapsedSeconds = getPracticeElapsedSeconds(session, now)
  const transitions = {
    first_half: { next: 'half_time', label: 'Half-time', timerStatus: 'paused', status: 'practice_live' },
    half_time: { next: 'second_half', label: 'Second half started', timerStatus: 'running', status: 'practice_live' },
    second_half: { next: 'full_time', label: 'Full-time reached', timerStatus: 'paused', status: 'practice_live' },
    full_time: { next: 'completed', label: 'Practice match concluded', timerStatus: 'concluded', status: 'practice_complete' },
  }
  const transition = transitions[phase]

  if (!transition) {
    return session
  }

  return withUpdatedAt(session, now, {
    match: {
      ...session.match,
      currentMatchPhase: transition.next,
      status: transition.status,
      timerStatus: transition.timerStatus,
      timerStartedAt: transition.timerStatus === 'running' ? occurredAt : null,
      timerElapsedSeconds: elapsedSeconds,
    },
    events: addTimelineEvent(session, {
      type: 'lifecycle',
      label: transition.label,
      phase: transition.next,
      occurredAt,
    }),
  })
}

export function setPracticeGuideDismissed(session, guideDismissed, { now = Date.now() } = {}) {
  return withUpdatedAt(session, now, { guideDismissed: guideDismissed === true })
}

export function resetPracticeSession(session, { now = Date.now() } = {}) {
  return createPracticeSession({ guideDismissed: session?.guideDismissed === true, now })
}
