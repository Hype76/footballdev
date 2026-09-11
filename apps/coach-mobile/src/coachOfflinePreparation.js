export const COACH_PREPARATION_REFRESH_MS = 5 * 60 * 1000

export async function prepareCoachOfflineData({ user, context, dependencies, isCurrent = () => true, now = Date.now }) {
  const { readResources, readOutbox, saveResources, getPlayers, getDevelopment, getCalendar, getMatches, getMatch, updateOutbox } = dependencies
  const saved = await readResources(user.id, context)
  const keys = ['players', 'phase31e:development', 'calendar', 'matchDayList']
  const isFresh = key => saved?.resources?.[key] !== undefined && now() - Date.parse(saved?.resourceMetadata?.[key]?.checkedAt || saved?.resourceMetadata?.[key]?.savedAt) < COACH_PREPARATION_REFRESH_MS
  const fresh = keys.every(isFresh)
  if (!isCurrent()) return { cancelled: true }
  if (fresh) {
    const today = new Date(now()).toISOString().slice(0, 10)
    const required = saved.resources.matchDayList.filter(match => !['completed', 'cancelled', 'deleted'].includes(match.status) && match.matchDate >= today).sort((a, b) => a.matchDate.localeCompare(b.matchDate)).slice(0, 8)
    const journals = await Promise.all(required.map(match => readOutbox(user.id, context, match.id)))
    if (journals.every(journal => journal?.baseMatch && (journal.pending?.length || now() - Date.parse(journal.verifiedAt) < COACH_PREPARATION_REFRESH_MS))) return { skipped: true }
  }
  const save = async resources => { if (isCurrent()) await saveResources(user.id, context, resources) }
  const players = isFresh('players') ? saved.resources.players : await getPlayers(user)
  if (!isCurrent()) return { cancelled: true }
  if (!isFresh('players')) await save({ players, calendarPlayers: players, matchDayPlayers: players })
  const development = isFresh('phase31e:development') ? saved.resources['phase31e:development'] : await getDevelopment(user)
  if (!isCurrent()) return { cancelled: true }
  if (!isFresh('phase31e:development')) await save({ 'phase31e:development': development })
  const calendar = isFresh('calendar') ? saved.resources.calendar : await getCalendar(user)
  if (!isCurrent()) return { cancelled: true }
  if (!isFresh('calendar')) await save({ calendar })
  const matches = isFresh('matchDayList') ? saved.resources.matchDayList : await getMatches(user)
  if (!isCurrent()) return { cancelled: true }
  const today = new Date(now()).toISOString().slice(0, 10)
  const upcoming = matches.filter(match => !['completed', 'cancelled', 'deleted'].includes(match.status) && match.matchDate >= today)
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate)).slice(0, 8)
  for (const match of upcoming) {
    if (!isCurrent()) return { cancelled: true }
    const journal = await readOutbox(user.id, context, match.id)
    if (journal?.baseMatch && (journal.pending?.length || now() - Date.parse(journal.verifiedAt) < COACH_PREPARATION_REFRESH_MS)) continue
    const detail = await getMatch(user, match.id)
    if (!isCurrent()) return { cancelled: true }
    await updateOutbox(user.id, context, detail.id, previous => {
      if (!isCurrent() || previous?.pending?.length) return previous
      return { baseMatch: detail, pending: [], verifiedAt: new Date(now()).toISOString(), error: '' }
    })
  }
  // Only mark preparation fresh after all fixtures succeed. Partial runs retry.
  if (!isFresh('matchDayList')) await save({ matchDayList: matches })
  return { saved: isCurrent(), fixtures: upcoming.length }
}

export function createCoachPreparationRunner({ run, isActive, now = Date.now }) {
  let running = false
  let stopped = false
  let retryAt = 0
  return {
    async refresh() {
      if (stopped || running || !isActive() || now() < retryAt) return
      running = true
      try {
        const result = await run(() => !stopped && isActive())
        retryAt = now() + (result?.cancelled ? 0 : COACH_PREPARATION_REFRESH_MS)
      } catch { retryAt = now() + 30_000 }
      finally { running = false }
    },
    stop() { stopped = true },
  }
}
