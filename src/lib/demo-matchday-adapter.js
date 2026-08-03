const DEMO_STORAGE_KEY = 'football-player-demo-gameday-v1'

export const DEMO_MATCH_DAY_NAMESPACE = 'demo-gameday'
export const DEMO_MATCH_DAY_CLUB_ID = `${DEMO_MATCH_DAY_NAMESPACE}:club:academy`
export const DEMO_MATCH_DAY_TEAM_ID = `${DEMO_MATCH_DAY_NAMESPACE}:team:u16`
export const DEMO_MATCH_DAY_FIXTURE_ID = `${DEMO_MATCH_DAY_NAMESPACE}:fixture:practice`

const DEMO_PLAYERS = Object.freeze([
  Object.freeze({ id: `${DEMO_MATCH_DAY_NAMESPACE}:player:alex-morgan`, playerName: 'Alex Morgan', shirtNumber: '9', status: 'active', section: 'Squad' }),
  Object.freeze({ id: `${DEMO_MATCH_DAY_NAMESPACE}:player:maya-singh`, playerName: 'Maya Singh', shirtNumber: '8', status: 'active', section: 'Squad' }),
  Object.freeze({ id: `${DEMO_MATCH_DAY_NAMESPACE}:player:noah-turner`, playerName: 'Noah Turner', shirtNumber: '5', status: 'active', section: 'Squad' }),
  Object.freeze({ id: `${DEMO_MATCH_DAY_NAMESPACE}:player:ruby-carter`, playerName: 'Ruby Carter', shirtNumber: '1', status: 'active', section: 'Squad' }),
])

const TIMER_ACTIONS = new Set(['start', 'pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude'])
export const DEMO_MATCH_DAY_SUPPORTED_EVENT_TYPES = Object.freeze(['goal', 'yellow_card', 'red_card', 'substitution', 'water_break'])
const STAFF_EVENT_TYPES = new Set(DEMO_MATCH_DAY_SUPPORTED_EVENT_TYPES.filter((eventType) => eventType !== 'goal'))

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function todayDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nowIso() {
  return new Date().toISOString()
}

function nextSyntheticId(kind, sequence) {
  return `${DEMO_MATCH_DAY_NAMESPACE}:${kind}:${sequence}`
}

export function isDemoMatchDayId(value, kind = '') {
  const normalizedValue = normalizeText(value)
  const prefix = kind ? `${DEMO_MATCH_DAY_NAMESPACE}:${kind}:` : `${DEMO_MATCH_DAY_NAMESPACE}:`
  return normalizedValue.startsWith(prefix)
}

export function assertDemoMatchDayId(value, kind, label = kind) {
  if (!isDemoMatchDayId(value, kind)) {
    throw new Error(`Demo Game Day rejected a non-synthetic ${label} identifier.`)
  }

  return normalizeText(value)
}

function buildDemoPlayer(player) {
  return {
    ...player,
    clubId: DEMO_MATCH_DAY_CLUB_ID,
    teamId: DEMO_MATCH_DAY_TEAM_ID,
    team: 'Demo Academy U16',
  }
}

function buildInitialMatch() {
  const demoDate = todayDate()
  const createdAt = `${demoDate}T12:00:00.000Z`
  const players = DEMO_PLAYERS.map(buildDemoPlayer)

  return {
    id: DEMO_MATCH_DAY_FIXTURE_ID,
    clubId: DEMO_MATCH_DAY_CLUB_ID,
    teamId: DEMO_MATCH_DAY_TEAM_ID,
    teamName: 'Demo Academy U16',
    opponent: 'Demo City Juniors',
    fixtureType: 'league',
    conclusionRule: 'normal_time',
    currentMatchPhase: 'pre_match',
    extraTimeHalfMinutes: 10,
    extraTimePeriodCount: 2,
    matchDate: demoDate,
    kickoffTime: '15:00:00',
    kickoffTimeTbc: false,
    arrivalTime: '14:15:00',
    homeAway: 'home',
    clockMode: 'fixed',
    matchDurationMinutes: 70,
    venueName: 'Demo Academy Ground',
    venueAddress: '1 Practice Way',
    notes: 'Synthetic practice fixture. No customer data or communication is used.',
    scorerRequestMessage: 'Demo scorer practice',
    requestScorer: true,
    requestLinesman: true,
    requestReferee: true,
    autoSelectAvailablePlayers: true,
    parentVisible: false,
    parentAudience: 'none',
    notificationRevision: 1,
    status: 'scorer_request',
    homeScore: 0,
    awayScore: 0,
    normalTimeHomeScore: null,
    normalTimeAwayScore: null,
    extraTimeHomeScore: null,
    extraTimeAwayScore: null,
    homeShootoutScore: 0,
    awayShootoutScore: 0,
    shootoutWinner: '',
    phaseStartedAt: '',
    timerStartedAt: '',
    timerPausedAt: '',
    timerElapsedSeconds: 0,
    timerStatus: 'not_started',
    fullTimeResumeStatus: '',
    concludedAt: '',
    concludedBy: '',
    enableMotmPoll: true,
    motmPollExpiryHours: 2,
    motmPollId: '',
    previousHiddenAt: '',
    deletedAt: '',
    deletedBy: '',
    isToday: true,
    presentationPriority: 1,
    scheduledKickoffAt: `${demoDate}T15:00:00`,
    isBeforeKickoff: true,
    serverLocalDate: demoDate,
    serverLocalTime: '12:00:00',
    availabilityStatus: '',
    availabilityRespondedAt: '',
    volunteerScorerResponse: 'no_response',
    volunteerLinesmanResponse: 'no_response',
    volunteerRefereeResponse: 'no_response',
    volunteerRespondedAt: '',
    hasInterest: false,
    isScorer: false,
    createdByName: 'Demo Coach',
    createdAt,
    updatedAt: createdAt,
    scorerInterests: [],
    scorerAssignments: [],
    roleAssignments: [],
    availabilityRequests: players.map((player, index) => ({
      id: nextSyntheticId('request', index + 1),
      requestId: nextSyntheticId('request', index + 1),
      matchDayId: DEMO_MATCH_DAY_FIXTURE_ID,
      playerId: player.id,
      playerName: player.playerName,
      parentLinkId: nextSyntheticId('parent', index + 1),
      authUserId: nextSyntheticId('user', index + 1),
      recipientName: `${player.playerName.split(' ')[0]} Demo Parent`,
      recipientEmail: `demo.parent.${index + 1}@footballplayer.test`,
      scorerEligible: index < 2,
      scorerEligibilityReason: index < 2 ? '' : 'Demo scorer practice is limited to eligible synthetic responses.',
      status: 'responded',
      respondedAt: createdAt,
      volunteerScorerResponse: index === 0 ? 'yes' : 'no_response',
      volunteerRefereeResponse: index === 1 ? 'yes' : 'no_response',
      volunteerLinesmanResponse: index === 2 ? 'yes' : 'no_response',
      volunteerRespondedAt: createdAt,
      transportNeedsLift: index === 2,
      transportCanOfferLift: index === 3,
      transportSeatsOffered: index === 3 ? 2 : 0,
      transportRespondedAt: createdAt,
    })),
    playerAvailability: players.map((player, index) => ({
      id: nextSyntheticId('availability', index + 1),
      matchDayId: DEMO_MATCH_DAY_FIXTURE_ID,
      playerId: player.id,
      playerName: player.playerName,
      status: index === 3 ? 'maybe' : 'available',
      transportStatus: index === 2 ? 'lift_needed' : index === 3 ? 'lift_offered' : 'not_required',
    })),
    squadDecisionState: 'selected',
    squadDecisionUpdatedAt: createdAt,
    confirmedTeam: players.map((player) => player.playerName),
    squadDecisions: players.map((player, index) => ({
      id: nextSyntheticId('decision', index + 1),
      matchDayId: DEMO_MATCH_DAY_FIXTURE_ID,
      clubId: DEMO_MATCH_DAY_CLUB_ID,
      teamId: DEMO_MATCH_DAY_TEAM_ID,
      playerId: player.id,
      playerName: player.playerName,
      status: 'selected',
      createdAt,
      updatedAt: createdAt,
    })),
    availabilityHistory: [],
    eventLog: [{
      id: nextSyntheticId('log', 1),
      eventType: 'match_day_created',
      label: 'Demo fixture ready',
      createdAt,
      createdByName: 'Demo Coach',
      metadata: { source: 'demo_matchday_adapter' },
    }],
    events: [],
    shootoutEvents: [],
    finalReport: null,
    isHydrated: true,
  }
}

function buildInitialState() {
  return {
    version: 1,
    sequence: 10,
    matches: [buildInitialMatch()],
  }
}

function createMemoryStorage() {
  let value = null
  return {
    getItem() {
      return value
    },
    setItem(_key, nextValue) {
      value = String(nextValue)
    },
    removeItem() {
      value = null
    },
  }
}

function resolveStorage(storage) {
  if (storage) return storage
  if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage
  return createMemoryStorage()
}

function createStore(storage, scopeKey = '') {
  const resolvedStorage = resolveStorage(storage)
  const resolvedScopeKey = normalizeText(scopeKey) || 'default'
  const storageKey = `${DEMO_STORAGE_KEY}:${resolvedScopeKey}`

  function read() {
    try {
      const parsed = JSON.parse(resolvedStorage.getItem(storageKey) || 'null')
      if (parsed?.version === 1 && Array.isArray(parsed.matches)) return parsed
    } catch {
      // Fall through to a fresh isolated demo state.
    }

    const state = buildInitialState()
    resolvedStorage.setItem(storageKey, JSON.stringify(state))
    return state
  }

  function write(state) {
    resolvedStorage.setItem(storageKey, JSON.stringify(state))
    return clone(state)
  }

  function reset() {
    const state = buildInitialState()
    resolvedStorage.setItem(storageKey, JSON.stringify(state))
    return clone(state)
  }

  return { read, reset, write }
}

function getMatch(state, matchId) {
  const resolvedId = assertDemoMatchDayId(matchId, 'fixture', 'fixture')
  const match = state.matches.find((candidate) => candidate.id === resolvedId && !candidate.deletedAt)
  if (!match) throw new Error('Choose a synthetic Demo Game Day fixture.')
  assertDemoMatchDayId(match.teamId, 'team', 'Team')
  assertDemoMatchDayId(match.clubId, 'club', 'club')
  return match
}

function saveMatch(store, state, match) {
  match.updatedAt = nowIso()
  state.matches = state.matches.map((candidate) => candidate.id === match.id ? match : candidate)
  store.write(state)
  return clone(match)
}

function getEventScores(match, eventTeamSide, amount = 1) {
  const clubIsHome = match.homeAway !== 'away'
  const isHome = eventTeamSide === 'club' ? clubIsHome : !clubIsHome
  return {
    homeScore: Math.max(0, Number(match.homeScore ?? 0) + (isHome ? amount : 0)),
    awayScore: Math.max(0, Number(match.awayScore ?? 0) + (isHome ? 0 : amount)),
  }
}

function createEvent(match, state, event) {
  const sequence = ++state.sequence
  const scores = event.eventType === 'goal'
    ? getEventScores(match, event.teamSide, 1)
    : { homeScore: Number(match.homeScore ?? 0), awayScore: Number(match.awayScore ?? 0) }
  const createdAt = nowIso()
  const savedEvent = {
    id: nextSyntheticId('event', sequence),
    matchDayId: match.id,
    eventType: event.eventType,
    teamSide: event.teamSide === 'opponent' ? 'opponent' : 'club',
    teamSideRecorded: true,
    minute: event.minute === '' || event.minute === null || event.minute === undefined ? null : Number(event.minute),
    scorerName: normalizeText(event.scorerName ?? event.playerName),
    scorerInitials: '',
    scorerShirtNumber: normalizeText(event.scorerShirtNumber ?? event.playerShirtNumber),
    assistName: normalizeText(event.assistName),
    assistInitials: '',
    assistShirtNumber: normalizeText(event.assistShirtNumber),
    playerOnName: normalizeText(event.playerOnName),
    playerOnShirtNumber: normalizeText(event.playerOnShirtNumber),
    homeScore: scores.homeScore,
    awayScore: scores.awayScore,
    notes: normalizeText(event.notes),
    isPenaltyGoal: event.isPenaltyGoal === true,
    eventStatus: 'active',
    correctedAt: '',
    correctedByName: '',
    voidedAt: '',
    voidedByName: '',
    correctionReason: '',
    eventTeamId: DEMO_MATCH_DAY_TEAM_ID,
    eventTeamName: match.teamName,
    matchPhase: match.currentMatchPhase,
    phaseOrder: null,
    stoppageMinute: null,
    eventSequence: sequence,
    correctionMetadata: {},
    createdByName: 'Demo Coach',
    createdAt,
  }
  match.homeScore = scores.homeScore
  match.awayScore = scores.awayScore
  match.events = [...match.events, savedEvent]
  return savedEvent
}

function assertStarted(match) {
  if (match.timerStatus === 'not_started' || ['scheduled', 'scorer_request'].includes(match.status)) {
    throw new Error('Start the match before recording goals or events.')
  }
}

export function createDemoMatchDayAdapter({ scopeKey = '', storage } = {}) {
  const store = createStore(storage, scopeKey)

  const readMatches = () => store.read().matches.filter((match) => !match.deletedAt && !match.previousHiddenAt)

  return Object.freeze({
    mode: 'demo',
    allowsCommunication: false,
    resetPolicy: 'isolated_session_state',

    async getMatchDays() {
      return clone(readMatches())
    },

    async getMatchDay({ matchDayId }) {
      return clone(getMatch(store.read(), matchDayId))
    },

    async getTeams() {
      return [{ id: DEMO_MATCH_DAY_TEAM_ID, clubId: DEMO_MATCH_DAY_CLUB_ID, name: 'Demo Academy U16' }]
    },

    async getPlayers() {
      return DEMO_PLAYERS.map(buildDemoPlayer).map(clone)
    },

    async getMatchLocations() {
      return [{ id: nextSyntheticId('location', 1), name: 'Demo Academy Ground', address: '1 Practice Way' }]
    },

    async getParentEmailTemplates() {
      return []
    },

    async reset() {
      return store.reset().matches.map(clone)
    },

    async createMatchDay({ match }) {
      const state = store.read()
      const suppliedTeamId = normalizeText(match?.teamId)
      if (suppliedTeamId) assertDemoMatchDayId(suppliedTeamId, 'team', 'Team')
      const sequence = ++state.sequence
      const template = buildInitialMatch()
      const created = {
        ...template,
        ...clone(match || {}),
        id: nextSyntheticId('fixture', sequence),
        clubId: DEMO_MATCH_DAY_CLUB_ID,
        teamId: DEMO_MATCH_DAY_TEAM_ID,
        teamName: 'Demo Academy U16',
        parentVisible: false,
        parentAudience: 'none',
        requestScorer: false,
        requestLinesman: false,
        requestReferee: false,
        scorerRequestMessage: '',
        status: 'scheduled',
        currentMatchPhase: 'pre_match',
        timerStatus: 'not_started',
        timerElapsedSeconds: 0,
        homeScore: 0,
        awayScore: 0,
        events: [],
        eventLog: [],
        roleAssignments: [],
        scorerAssignments: [],
        concludedAt: '',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        isHydrated: true,
      }
      state.matches.push(created)
      store.write(state)
      return clone(created)
    },

    async updateMatchDay({ matchId, updates }) {
      const state = store.read()
      const match = getMatch(state, matchId)
      if (updates?.teamId) assertDemoMatchDayId(updates.teamId, 'team', 'Team')
      Object.assign(match, clone(updates || {}), { teamId: DEMO_MATCH_DAY_TEAM_ID, clubId: DEMO_MATCH_DAY_CLUB_ID })
      return saveMatch(store, state, match)
    },

    async createMatchDayEventLogEntry({ match, eventType, eventLabel, playerId = '', metadata = {} }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      if (playerId) assertDemoMatchDayId(playerId, 'player', 'Player')
      const entry = {
        id: nextSyntheticId('log', ++state.sequence),
        eventType: normalizeText(eventType) || 'match_day_updated',
        label: normalizeText(eventLabel) || 'Demo fixture updated',
        playerId: normalizeText(playerId),
        metadata: { ...metadata, communicationSuppressed: true, source: 'demo_matchday_adapter' },
        createdAt: nowIso(),
        createdByName: 'Demo Coach',
      }
      current.eventLog = [...current.eventLog, entry]
      saveMatch(store, state, current)
      return clone(entry)
    },

    async setMatchDayPlayerSquadDecision({ matchDayId, playerId, decision }) {
      const state = store.read()
      const match = getMatch(state, matchDayId)
      const resolvedPlayerId = assertDemoMatchDayId(playerId, 'player', 'Player')
      const player = DEMO_PLAYERS.find((candidate) => candidate.id === resolvedPlayerId)
      if (!player) throw new Error('Choose a synthetic Demo Game Day Player.')
      const status = normalizeText(decision?.status ?? decision) || 'waiting'
      const existing = match.squadDecisions.find((item) => item.playerId === resolvedPlayerId)
      const saved = {
        ...(existing || {}),
        id: existing?.id || nextSyntheticId('decision', ++state.sequence),
        matchDayId: match.id,
        clubId: DEMO_MATCH_DAY_CLUB_ID,
        teamId: DEMO_MATCH_DAY_TEAM_ID,
        playerId: resolvedPlayerId,
        playerName: player.playerName,
        status,
        updatedAt: nowIso(),
      }
      match.squadDecisions = [...match.squadDecisions.filter((item) => item.playerId !== resolvedPlayerId), saved]
      match.confirmedTeam = match.squadDecisions.filter((item) => item.status === 'selected').map((item) => item.playerName)
      saveMatch(store, state, match)
      return clone(saved)
    },

    async startMatchDay({ match, matchId }) {
      const state = store.read()
      const current = getMatch(state, match?.id ?? matchId)
      const timestamp = nowIso()
      current.status = 'live'
      current.currentMatchPhase = 'first_half'
      current.timerStatus = 'running'
      current.timerStartedAt = timestamp
      current.phaseStartedAt = timestamp
      return saveMatch(store, state, current)
    },

    async setMatchDayTimerState({ match, matchId, action }) {
      if (!TIMER_ACTIONS.has(action)) throw new Error('Choose a supported match clock action.')
      const state = store.read()
      const current = getMatch(state, match?.id ?? matchId)
      const timestamp = nowIso()

      if (action === 'start') {
        current.status = 'live'
        current.currentMatchPhase = 'first_half'
        current.timerStatus = 'running'
        current.timerStartedAt = timestamp
        current.phaseStartedAt = timestamp
      } else if (action === 'pause') {
        current.timerStatus = 'paused'
        current.timerPausedAt = timestamp
      } else if (action === 'hydration') {
        current.timerStatus = 'hydration'
        current.timerPausedAt = timestamp
      } else if (action === 'half_time') {
        current.status = 'half_time'
        current.currentMatchPhase = 'half_time'
        current.timerStatus = 'half_time'
        current.timerPausedAt = timestamp
      } else if (action === 'resume') {
        const wasFullTime = current.timerStatus === 'full_time'
        const wasHalfTime = current.timerStatus === 'half_time' || current.status === 'half_time'
        current.status = wasFullTime ? (current.fullTimeResumeStatus || 'second_half') : wasHalfTime ? 'second_half' : current.status
        current.currentMatchPhase = wasHalfTime || wasFullTime ? 'second_half' : current.currentMatchPhase
        current.timerStatus = 'running'
        current.timerStartedAt = timestamp
        current.timerPausedAt = ''
        current.concludedAt = ''
      } else if (action === 'full_time') {
        current.fullTimeResumeStatus = current.status === 'live' ? 'live' : 'second_half'
        current.status = 'full_time'
        current.currentMatchPhase = 'full_time'
        current.timerStatus = 'full_time'
        current.timerPausedAt = timestamp
      } else if (action === 'conclude') {
        if (current.status !== 'full_time') throw new Error('Reach full time before concluding the match.')
        current.concludedAt = timestamp
        current.concludedBy = 'Demo Coach'
      }

      return saveMatch(store, state, current)
    },

    async setMatchDayExtendedState({ match, matchId, action }) {
      const state = store.read()
      const current = getMatch(state, match?.id ?? matchId)
      const timestamp = nowIso()
      const updates = {
        start_extra_time: ['extra_time', 'extra_time_first_half', 'running'],
        end_extra_time_first_half: ['extra_time', 'extra_time_half_time', 'paused'],
        start_extra_time_second_half: ['extra_time', 'extra_time_second_half', 'running'],
        end_extra_time: ['extra_time', 'extra_time_complete', 'paused'],
        start_penalties: ['penalties', 'penalties', 'paused'],
        finish_penalties: ['full_time', 'full_time', 'full_time'],
      }
      const next = updates[action]
      if (!next) throw new Error('Choose a supported extended match action.')
      current.status = next[0]
      current.currentMatchPhase = next[1]
      current.timerStatus = next[2]
      current.phaseStartedAt = timestamp
      if (action === 'finish_penalties') current.timerPausedAt = timestamp
      return saveMatch(store, state, current)
    },

    async addStaffMatchDayGoal({ match, goal }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      assertStarted(current)
      const event = createEvent(current, state, { ...goal, eventType: 'goal' })
      saveMatch(store, state, current)
      return clone(event)
    },

    async addStaffMatchDayEvent({ match, event }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      assertStarted(current)
      if (!STAFF_EVENT_TYPES.has(event?.eventType)) throw new Error('Choose a supported Match Day event type.')
      const savedEvent = createEvent(current, state, event)
      saveMatch(store, state, current)
      return clone(savedEvent)
    },

    async updateStaffMatchDayScore({ match, homeScore, awayScore }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      assertStarted(current)
      current.homeScore = Math.max(0, Number(homeScore ?? 0))
      current.awayScore = Math.max(0, Number(awayScore ?? 0))
      return saveMatch(store, state, current)
    },

    async correctStaffMatchDayGoal({ match, event, goal, reason = '' }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      const eventId = assertDemoMatchDayId(event?.id, 'event', 'event')
      const target = current.events.find((candidate) => candidate.id === eventId)
      if (!target || target.eventType !== 'goal' || target.eventStatus !== 'active') throw new Error('Choose an active synthetic goal.')
      const previousSide = target.teamSide
      const nextSide = goal?.teamSide === 'opponent' ? 'opponent' : 'club'
      if (previousSide !== nextSide) {
        Object.assign(current, getEventScores(current, previousSide, -1))
        Object.assign(current, getEventScores(current, nextSide, 1))
      }
      Object.assign(target, {
        teamSide: nextSide,
        minute: goal?.minute === '' ? null : Number(goal?.minute ?? target.minute),
        scorerName: normalizeText(goal?.scorerName ?? target.scorerName),
        scorerShirtNumber: normalizeText(goal?.scorerShirtNumber ?? target.scorerShirtNumber),
        assistName: normalizeText(goal?.assistName ?? target.assistName),
        assistShirtNumber: normalizeText(goal?.assistShirtNumber ?? target.assistShirtNumber),
        notes: normalizeText(goal?.notes ?? target.notes),
        correctedAt: nowIso(),
        correctedByName: 'Demo Coach',
        correctionReason: normalizeText(reason),
        homeScore: current.homeScore,
        awayScore: current.awayScore,
      })
      saveMatch(store, state, current)
      return { matchDayId: current.id, homeScore: current.homeScore, awayScore: current.awayScore, status: current.status, event: clone(target) }
    },

    async voidStaffMatchDayEvent({ match, event, reasonCode = '', note = '' }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      const eventId = assertDemoMatchDayId(event?.id, 'event', 'event')
      const target = current.events.find((candidate) => candidate.id === eventId)
      if (!target || target.eventStatus !== 'active') throw new Error('Choose an active synthetic timeline event.')
      if (target.eventType === 'goal') Object.assign(current, getEventScores(current, target.teamSide, -1))
      Object.assign(target, {
        eventStatus: 'voided',
        voidedAt: nowIso(),
        voidedByName: 'Demo Coach',
        correctionReason: [normalizeText(reasonCode), normalizeText(note)].filter(Boolean).join(': '),
        homeScore: current.homeScore,
        awayScore: current.awayScore,
      })
      saveMatch(store, state, current)
      return { matchDayId: current.id, homeScore: current.homeScore, awayScore: current.awayScore, status: current.status, event: clone(target), events: clone(current.events) }
    },

    async recordMatchDayShootoutKick({ match, kick }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      const saved = {
        id: nextSyntheticId('shootout', ++state.sequence),
        matchDayId: current.id,
        teamSide: kick?.teamSide === 'opponent' ? 'opponent' : 'club',
        outcome: kick?.outcome === 'missed' ? 'missed' : 'scored',
        playerName: normalizeText(kick?.playerName),
        notes: normalizeText(kick?.notes),
        status: 'active',
        createdAt: nowIso(),
      }
      current.shootoutEvents = [...current.shootoutEvents, saved]
      if (saved.outcome === 'scored') {
        if (saved.teamSide === 'club') current.homeShootoutScore += 1
        else current.awayShootoutScore += 1
      }
      saveMatch(store, state, current)
      return clone(saved)
    },

    async voidMatchDayShootoutKick({ match, kickId }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      const resolvedKickId = assertDemoMatchDayId(kickId, 'shootout', 'shootout kick')
      const target = current.shootoutEvents.find((kick) => kick.id === resolvedKickId)
      if (!target || target.status !== 'active') throw new Error('Choose an active synthetic shootout kick.')
      target.status = 'voided'
      saveMatch(store, state, current)
      return { matchDayId: current.id, kickId: target.id, voided: true }
    },

    async selectMatchDayVolunteer({ match, volunteer, role = 'scorer', selected = true }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      const requestId = assertDemoMatchDayId(volunteer?.requestId, 'request', 'volunteer response')
      const request = current.availabilityRequests.find((item) => item.requestId === requestId)
      if (!request) throw new Error('Choose a synthetic volunteer response.')
      const assignment = {
        id: nextSyntheticId('role', ++state.sequence),
        matchDayId: current.id,
        role,
        parentLinkId: request.parentLinkId,
        authUserId: request.authUserId,
        parentEmail: request.recipientEmail,
        playerName: request.playerName,
        status: selected === false ? 'removed' : 'accepted',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      current.roleAssignments = current.roleAssignments.filter((item) => item.role !== role)
      if (selected !== false) current.roleAssignments.push(assignment)
      saveMatch(store, state, current)
      return { success: true, assignment: clone(assignment), communicationSuppressed: true }
    },

    async saveMatchDayFinalReport({ match, staffNotes = '' }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      if (current.status !== 'full_time') throw new Error('The final match report is available after full time.')
      current.finalReport = {
        id: nextSyntheticId('report', 1),
        matchDayId: current.id,
        staffNotes: normalizeText(staffNotes),
        createdByName: 'Demo Coach',
        createdAt: current.finalReport?.createdAt || nowIso(),
        updatedAt: nowIso(),
      }
      saveMatch(store, state, current)
      return clone(current.finalReport)
    },

    async resetPreviousMatchDayResults() {
      const state = store.read()
      state.matches.forEach((match) => {
        if (match.concludedAt) match.previousHiddenAt = nowIso()
      })
      store.write(state)
    },

    async deletePreviousMatchDay({ match }) {
      const state = store.read()
      const current = getMatch(state, match?.id)
      current.deletedAt = nowIso()
      saveMatch(store, state, current)
      return { matchDayId: current.id, deleted: true, alreadyDeleted: false }
    },
  })
}
