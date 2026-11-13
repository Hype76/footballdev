import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createThemeColorTokens } from '../lib/theme.js'
import { getClubMatchdayTv } from '../lib/domain/club-matchday-tv.js'
import { ClubTvSponsorImage } from '../components/ClubTvSponsorImage.jsx'
import { activeTvSponsors, clubTvDate, newTvGoals, TV_PAGE_SIZE, TV_RECOVERY_MS, TV_REFRESH_MS, TV_ROTATION_SECONDS, tvMatchSides, tvMatchStatus, tvPitchNumber } from '../lib/club-matchday-tv.js'
import fpLogo from '../assets/football-player-logo.webp'
import { isClubTvLocked, setClubTvLocked } from '../lib/club-tv-lock.js'
import './club-matchday-tv.css'

const timeLabel = (value) => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })
const dayLabel = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fixtureDayLabel = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const goalTime = (goal) => Date.parse(goal.event.createdAt) || 0

function BrandCredit() {
  return <div className="club-tv-credit"><img src={fpLogo} alt="Football Player" /><span>footballplayer.online</span></div>
}

function WeatherIcon({ condition }) {
  const value = String(condition).toLowerCase()
  const rain = /rain|sleet|shower/.test(value), snow = /snow|sleet/.test(value), thunder = value.includes('thunder'), fog = value.includes('fog')
  const sun = /clear|fair|partly/.test(value)
  return <svg className="club-tv-weather-icon" role="img" aria-label={condition} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    {sun ? <g className="club-tv-weather-sun"><circle cx={rain || value.includes('cloud') ? 23 : 32} cy={rain || value.includes('cloud') ? 22 : 30} r="11" /><path d="M32 6v5M32 49v5M8 30h5M51 30h5M15 13l4 4M45 44l4 4M15 47l4-4M46 15l4-4" /></g> : null}
    {!sun || rain || value.includes('cloud') ? <path className="club-tv-weather-cloud" d="M17 42h30a10 10 0 0 0 1-20 15 15 0 0 0-28-4 12 12 0 0 0-3 24Z" /> : null}
    {rain ? <path className="club-tv-weather-rain" d="m22 49-3 7m15-7-3 7m15-7-3 7" /> : null}
    {snow ? <path d="M25 48v12m-5-9 10 6m-10 0 10-6m14-3v12m-5-9 10 6m-10 0 10-6" /> : null}
    {thunder ? <path className="club-tv-weather-sun" d="m35 42-7 10h8l-5 10" /> : null}
    {fog ? <path d="M12 49h40M17 57h30" /> : null}
  </svg>
}

function TeamBadge({ src, muted = false }) {
  return <img className={`club-tv-team-badge${muted || !src ? ' club-tv-team-badge-fallback' : ''}`} src={src || fpLogo} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fpLogo; event.currentTarget.classList.add('club-tv-team-badge-fallback') }} />
}

function GroundWeather({ clubId, postcode, viewerSlug, configured }) {
  const [forecast, setForecast] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!configured) return
    let active = true, busy = false
    let controller
    async function refresh() {
      if (busy || document.hidden) return
      busy = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      try {
        const result = await getClubMatchdayTv({ clubId, action: 'weather', postcode, slug: viewerSlug, signal: controller.signal })
        if (active) { setForecast(result.weather); setError('') }
      } catch {
        if (active) { setForecast(null); setError('Ground weather unavailable') }
      } finally { clearTimeout(timeout); busy = false }
    }
    refresh()
    const timer = setInterval(refresh, 15 * 60000)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [clubId, configured, postcode, viewerSlug])
  if (!configured) return <div className="club-tv-weather"><small>LOCAL WEATHER</small><span>Ground postcode not set</span></div>
  return <div className="club-tv-weather" aria-label="Club ground weather">
    <small>GROUND FORECAST</small>
    {forecast ? <><div className="club-tv-weather-reading"><WeatherIcon condition={forecast.condition} /><div className="club-tv-weather-details"><strong>{forecast.temperature}°C</strong><span>{forecast.condition.replace(/clearsky/g, 'Clear sky').replace(/partlycloudy/g, 'Partly cloudy').replace(/heavyrain/g, 'Heavy rain').replace(/lightrain/g, 'Light rain')}</span></div></div><span>{forecast.location} · Wind {forecast.windMph} mph</span><small className="club-tv-weather-source">{timeLabel(forecast.time)} · <a href="https://api.met.no/" target="_blank" rel="noreferrer">MET Norway</a></small></> : <span>{error || 'Loading ground weather…'}</span>}
  </div>
}

function EventLine({ events, side }) {
  return <div className="club-tv-events">{events.filter((event) => event.side === side).map((event) => <span key={event.id} className={event.type === 'red_card' ? 'club-tv-red' : ''}>
    <span aria-label={event.type === 'red_card' ? 'Red card' : 'Goal'}>{event.type === 'red_card' ? '▮' : '●'}</span> {event.shirt ? `#${event.shirt}` : ''}{event.minute == null ? '' : ` ${event.minute}${event.stoppage ? `+${event.stoppage}` : ''}′`}
  </span>)}</div>
}

function MatchRow({ match, status, clubLogo, showDate }) {
  const sides = tvMatchSides(match)
  const homeSide = sides.clubHome ? 'club' : 'opponent', awaySide = sides.clubHome ? 'opponent' : 'club'
  const started = status.kind !== 'upcoming'
  return <article className={`club-tv-match club-tv-${status.kind}`}>
    <div className="club-tv-match-meta"><strong>{status.label}</strong>{showDate ? <span>{fixtureDayLabel(match.matchDate)}</span> : null}</div>
    <div className={`club-tv-team club-tv-home ${sides.clubHome ? 'club-tv-own' : ''}`}><div className="club-tv-team-heading"><TeamBadge src={sides.clubHome ? clubLogo : ''} muted={!sides.clubHome} /><strong className="club-tv-team-name" title={sides.home}>{sides.home}</strong></div>{started ? <EventLine events={match.events} side={homeSide} /> : null}</div>
    <div className="club-tv-score">
      <strong data-result={status.result}>{started ? `${match.homeScore} : ${match.awayScore}` : 'v'}{status.result ? <span className="sr-only">, club {status.result}</span> : null}</strong>
      {started && (match.status === 'penalties' || match.homeShootoutScore || match.awayShootoutScore) ? <small>PENS {match.homeShootoutScore} : {match.awayShootoutScore}</small> : null}
    </div>
    <div className={`club-tv-team ${!sides.clubHome ? 'club-tv-own' : ''}`}><div className="club-tv-team-heading"><TeamBadge src={!sides.clubHome ? clubLogo : ''} muted={sides.clubHome} /><strong className="club-tv-team-name" title={sides.away}>{sides.away}</strong></div>{started ? <EventLine events={match.events} side={awaySide} /> : null}</div>
  </article>
}

function HomeFixtureRow({ match, clubLogo, showDate }) {
  return <article className={`club-tv-home-row${showDate ? ' club-tv-home-row-week' : ''}`}>
    <strong className="club-tv-home-time">{match.kickoffTbc ? 'TBC' : match.kickoff || 'TBC'}</strong>
    <div className="club-tv-home-teams">
      <span><TeamBadge src={clubLogo} /><strong className="club-tv-team-name" title={match.teamName}>{match.teamName}</strong></span>
      <span className="club-tv-home-opponent"><span>v</span><strong className="club-tv-team-name" title={match.opponent}>{match.opponent}</strong></span>
    </div>
    <span className="club-tv-home-pitch">{tvPitchNumber(match.venue)}</span>
    {showDate ? <span className="club-tv-home-date">{fixtureDayLabel(match.matchDate)}</span> : null}
  </article>
}

function RoadTicker({ matches, clubLogo, showDate, paused }) {
  const [reducedMotion, setReducedMotion] = useState(false)
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!reducedMotion || paused || matches.length < 2) return undefined
    const timer = setInterval(() => setIndex(current => (current + 1) % matches.length), TV_ROTATION_SECONDS * 1000)
    return () => clearInterval(timer)
  }, [matches.length, paused, reducedMotion])
  const selected = reducedMotion && matches.length ? matches.slice(index % matches.length, (index % matches.length) + 1) : matches
  const items = selected.map((match) => <span className="club-tv-road-item" key={match.id}>
    <TeamBadge src="" muted /><span className="club-tv-team-name" title={match.opponent}>{match.opponent}</span><span>v</span><TeamBadge src={clubLogo} /><span className="club-tv-team-name" title={match.teamName}>{match.teamName}</span><strong>{showDate ? `${fixtureDayLabel(match.matchDate)} · ` : ''}{match.kickoffTbc ? 'KO TBC' : `KO ${match.kickoff || 'TBC'}`}</strong>
  </span>)
  return <div className="club-tv-road"><strong>ON THE ROAD</strong>{items.length ? <div className="club-tv-road-window"><div className="club-tv-road-track"><div>{items}</div>{!reducedMotion ? <div aria-hidden="true">{items}</div> : null}</div></div> : <span className="club-tv-road-empty">{showDate ? 'No away fixtures in this period' : 'No away fixtures today'}</span>}{reducedMotion && matches.length > 1 ? <span className="club-tv-road-controls"><button aria-label="Previous away fixture" onClick={() => setIndex(current => (current - 1 + matches.length) % matches.length)}>‹</button><span>{index % matches.length + 1} / {matches.length}</span><button aria-label="Next away fixture" onClick={() => setIndex(current => (current + 1) % matches.length)}>›</button></span> : null}</div>
}

function UnlockDisplay({ clubId, onUnlocked, onClose }) {
  const dialog = useRef(null), passwordInput = useRef(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const element = dialog.current, input = passwordInput.current
    element.showModal()
    return () => { mounted.current = false; input.value = ''; element.close() }
  }, [])
  async function unlock(event) {
    event.preventDefault()
    setBusy(true); setError('')
    let password = passwordInput.current.value
    passwordInput.current.value = ''
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const result = await getClubMatchdayTv({ clubId, action: 'unlock', password, signal: controller.signal })
      if (result.unlocked !== true) throw new Error('The display could not be unlocked.')
      if (mounted.current) onUnlocked()
    } catch (failure) { if (mounted.current) { setError(failure.message || 'Unable to verify your password. The display stays locked.'); setBusy(false); passwordInput.current?.focus() } }
    finally { password = ''; clearTimeout(timeout) }
  }
  return <dialog ref={dialog} className="club-tv-settings" onCancel={onClose} aria-labelledby="club-tv-unlock-title"><form autoComplete="off" onSubmit={unlock}>
    <h2 id="club-tv-unlock-title">Unlock Club Admin</h2><p>Enter your own Club Admin password to leave the match display. Your password is never saved or logged by the app. This box closes after 2 minutes and keeps the display locked.</p>
    <label>Club Admin password <input ref={passwordInput} type="password" name="display-unlock-password" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={1024} disabled={busy} /></label>
    {error ? <p role="alert">{error}</p> : null}<div className="club-tv-settings-actions"><button type="button" onClick={onClose}>Keep display locked</button><button disabled={busy} type="submit">{busy ? 'Checking…' : 'Unlock and return'}</button></div>
  </form></dialog>
}

export function ClubMatchdayTvDisplay({ user, preferences, standalone = false, preview = false, viewerSlug, onAccessDenied, weatherConfigured = Boolean(preferences.weatherPostcode) }) {
  const [date, setDate] = useState(() => clubTvDate())
  const [period, setPeriod] = useState('day')
  useEffect(() => {
    let today = clubTvDate()
    const timer = setInterval(() => {
      const next = clubTvDate()
      if (next !== today) { const previous = today; today = next; setDate((selected) => selected === previous ? next : selected) }
    }, 30000)
    return () => clearInterval(timer)
  }, [])
  return <ClubDayDisplay key={`${date}:${period}`} user={user} preferences={preferences} standalone={standalone} preview={preview} date={date} setDate={setDate} period={period} setPeriod={setPeriod} viewerSlug={viewerSlug} onAccessDenied={onAccessDenied} weatherConfigured={weatherConfigured} />
}

function ClubDayDisplay({ user, preferences, standalone, preview, date, setDate, period, setPeriod, viewerSlug, onAccessDenied, weatherConfigured }) {
  const navigate = useNavigate()
  const [feed, setFeed] = useState(null)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [capacity, setCapacity] = useState(TV_PAGE_SIZE)
  const [homeCapacity, setHomeCapacity] = useState(6)
  const [viewportVersion, setViewportVersion] = useState(0)
  const hasMap = !denied && Boolean(preferences.showMap && preferences.map)
  const pageSize = Math.min(TV_PAGE_SIZE, capacity)
  const homePageSize = homeCapacity
  const [now, setNow] = useState(Date.now)
  const sponsorToday = clubTvDate(new Date(now))
  const activeSponsors = useMemo(() => activeTvSponsors(preferences.sponsorAds, sponsorToday), [preferences.sponsorAds, sponsorToday])
  const sponsorSlides = useMemo(() => {
    if (denied) return []
    return hasMap && !preferences.showPitchsideOrdering ? [...activeSponsors, { image: '/club-tv-goal-alerts.webp', goalAlerts: true }] : activeSponsors
  }, [activeSponsors, denied, hasMap, preferences.showPitchsideOrdering])
  const [carousel, setCarousel] = useState({ page: 0, seconds: TV_ROTATION_SECONDS, anchor: null })
  const [sponsorIndex, setSponsorIndex] = useState(0)
  const sponsor = sponsorSlides[sponsorIndex % sponsorSlides.length]
  const [paused, setPaused] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [goal, setGoal] = useState(null)
  const [recovering, setRecovering] = useState(false)
  const [locked, setLocked] = useState(() => !standalone && isClubTvLocked(user))
  const [unlocking, setUnlocking] = useState(false)
  useEffect(() => {
    if (!unlocking) return
    const timeout = setTimeout(() => setUnlocking(false), 120000)
    return () => clearTimeout(timeout)
  }, [unlocking])
  const root = useRef(null)
  const weekAhead = period === 'day' && feed?.window?.kind === 'week'
  const rangeView = period !== 'day' || weekAhead
  const selectedToday = date === clubTvDate(new Date(now))
  const fixtures = (feed?.matches || []).map(match => ({ match, status: tvMatchStatus(match) }))
  const scores = fixtures.filter(({ status }) => status.kind === 'live' || status.kind === 'finished' || (period !== 'day' && status.kind === 'upcoming'))
  const liveCount = scores.filter(({ status }) => status.kind === 'live').length
  if (period === 'day' && !weekAhead) scores.push(...fixtures.filter(({ status }) => status.kind === 'upcoming'))
  const homeFixtures = (feed?.matches || []).filter(match => match.homeAway !== 'away')
  const awayFixtures = (feed?.matches || []).filter(match => match.homeAway === 'away')
  const scorePages = Math.max(1, Math.ceil(scores.length / pageSize))
  const homePages = Math.max(1, Math.ceil(homeFixtures.length / homePageSize))
  const totalPages = Math.max(scorePages, homePages)
  const { anchor, seconds } = carousel
  const anchorIndex = !anchor ? -1 : anchor.home
    ? homeFixtures.findIndex(match => match.id === anchor.id)
    : scores.findIndex(({ match }) => match.id === anchor.id)
  const currentPage = anchorIndex < 0 ? Math.min(carousel.page, totalPages - 1)
    : Math.floor(anchorIndex / (anchor.home ? homePageSize : pageSize))
  const firstScore = (currentPage % scorePages) * pageSize
  const firstHome = (currentPage % homePages) * homePageSize
  const pageScores = scores.slice(firstScore, firstScore + pageSize)
  const latestGoalScore = goal && scores.find(({ match }) => match.id === goal.match.id)
  const visibleScores = latestGoalScore
    ? [latestGoalScore, ...pageScores.filter(({ match }) => match.id !== latestGoalScore.match.id)].slice(0, pageSize)
    : pageScores
  const rememberCurrentPage = useEffectEvent(() => {
    if (goal || recovering) return
    const home = currentPage >= scorePages || !pageScores.length
    const fixture = home ? homeFixtures[firstHome] : pageScores[0]?.match
    setCarousel(current => ({ ...current, page: currentPage, anchor: fixture ? { id: fixture.id, home } : null }))
  })
  useLayoutEffect(() => {
    if (!root.current || window.innerWidth <= 1000) return
    const fitRows = (panelSelector, rowSelector, setLimit) => {
      const panel = root.current.querySelector(panelSelector)
      const rows = [...panel?.querySelectorAll(rowSelector) || []]
      const bottom = panel?.getBoundingClientRect().bottom ?? Infinity
      const fitting = rows.filter(row => row.getBoundingClientRect().bottom <= bottom).length
      if (rows.length && fitting < rows.length) setLimit(Math.max(1, fitting))
    }
    fitRows('.club-tv-fixtures', '.club-tv-match', setCapacity)
    fitRows('.club-tv-home-panel', '.club-tv-home-row', setHomeCapacity)
  }, [feed, currentPage, goal, pageSize, homePageSize, hasMap, viewportVersion])
  useEffect(() => {
    const resize = () => { setCapacity(TV_PAGE_SIZE); setHomeCapacity(6); setViewportVersion((version) => version + 1) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    let previous = null, controller, revoked = false
    const seen = new Set()
    async function refresh(recovery = false) {
      if (document.hidden || revoked || (controller && !recovery)) return
      controller?.abort()
      const request = new AbortController()
      controller = request
      if (recovery) {
        rememberCurrentPage()
        setRecovering(true)
      }
      const timeout = setTimeout(() => request.abort(), 15000)
      try {
        const result = await getClubMatchdayTv({ clubId: user.clubId, date, period, slug: viewerSlug, signal: request.signal })
        if (controller !== request || request.signal.aborted) return
        const fresh = newTvGoals(previous, result.matches).filter(({ event, match }) => match.matchDate === clubTvDate() && !seen.has(event.id))
        for (const match of result.matches) for (const event of match.events) seen.add(event.id)
        if (fresh.length) {
          rememberCurrentPage()
          const latest = fresh.reduce((current, next) => goalTime(next) >= goalTime(current) ? next : current)
          setGoal(current => current && goalTime(current) > goalTime(latest) ? current : latest)
        }
        previous = result.matches
        setFeed(result); setError('')
      } catch (failure) {
        if (controller !== request) return
        previous = null
        if ([401, 403].includes(failure.status)) {
          revoked = true
          setGoal(null)
          setFeed(null)
          setDenied(true)
          onAccessDenied?.(failure)
        }
        setError(failure.message || 'Scores could not be refreshed.')
      } finally {
        clearTimeout(timeout)
        if (controller === request) {
          controller = null
          if (recovery) setRecovering(false)
        }
      }
    }
    const refreshScores = () => { void refresh() }
    refresh()
    const recoveryTimer = setInterval(() => { void refresh(true) }, TV_RECOVERY_MS)
    const timer = setInterval(refreshScores, TV_REFRESH_MS)
    document.addEventListener('visibilitychange', refreshScores)
    return () => {
      controller?.abort()
      controller = null
      clearInterval(timer)
      clearInterval(recoveryTimer)
      document.removeEventListener('visibilitychange', refreshScores)
    }
  }, [date, onAccessDenied, period, user.clubId, viewerSlug])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const rotate = useEffectEvent(() => {
    if (paused || goal || recovering || document.hidden || totalPages <= 1) return
    setCarousel(current => current.seconds <= 1
      ? { page: (currentPage + 1) % totalPages, seconds: TV_ROTATION_SECONDS, anchor: null }
      : { ...current, seconds: current.seconds - 1 })
  })
  useEffect(() => {
    const timer = setInterval(() => rotate(), 1000)
    return () => clearInterval(timer)
  }, [paused, goal, recovering, totalPages])
  useEffect(() => {
    if (sponsorSlides.length < 2) return undefined
    const timer = setInterval(() => { if (!document.hidden && !paused) setSponsorIndex(current => (current + 1) % sponsorSlides.length) }, preferences.sponsorSeconds * 1000)
    return () => clearInterval(timer)
  }, [paused, sponsorSlides, preferences.sponsorSeconds])
  useEffect(() => {
    if (!goal) return
    const timer = setTimeout(() => setGoal(current => current === goal ? null : current), 7000)
    return () => clearTimeout(timer)
  }, [goal])
  const club = feed?.club
  const theme = createThemeColorTokens(club?.accent || user.themeAccent || 'green', preferences.appearance)
  const changePage = (direction) => setCarousel({ page: (currentPage + direction + totalPages) % totalPages, seconds: TV_ROTATION_SECONDS, anchor: null })
  async function fullScreen() {
    try {
      if (!standalone) { setClubTvLocked(user, true); setLocked(true) }
      if (document.fullscreenElement) await document.exitFullscreen()
      else await root.current.requestFullscreen()
      setFullscreenError('')
    } catch { setFullscreenError('Full screen is unavailable in this browser. Use your browser’s full screen option.') }
  }
  if (standalone && denied) return <main className="mx-auto grid min-h-svh w-full max-w-md content-center gap-4 px-6">
    <h1 className="text-2xl font-bold">Club access required</h1>
    <p role="alert">{error}</p>
  </main>
  return <main ref={root} className={`club-tv club-tv-${preferences.appearance} ${hasMap ? 'club-tv-split' : ''}`} style={{ '--tv-accent': theme.accent, '--tv-accent-text': theme.accentText, '--tv-accent-readable': theme.textSecondary, '--tv-soft': theme.accentSoft }}>
    <header className="club-tv-header"><div className="club-tv-identity"><img src={club?.logoUrl || user.clubLogoUrl || fpLogo} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fpLogo }} /><div><small>WELCOME TO</small><h1>{club?.name || user.clubName || 'Your club'}</h1></div></div>
      {!denied ? <GroundWeather key={preferences.weatherPostcode} clubId={user.clubId} postcode={preferences.weatherPostcode} viewerSlug={viewerSlug} configured={weatherConfigured} /> : null}
      <div className="club-tv-clock"><strong>{timeLabel(now)}</strong><span>{new Date(now).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' })} · UK time</span></div>
    </header>
    <div className="club-tv-day"><h2>{weekAhead ? 'Week ahead' : period === 'weekend' ? 'Weekend' : period === 'week' ? 'Week' : period === 'month' ? 'Month' : dayLabel(date)}</h2>{rangeView && feed?.window ? <span className="club-tv-period">{fixtureDayLabel(feed.window.startDate)} to {fixtureDayLabel(feed.window.endDate)}</span> : null}<span>{fixtures.length} matches · {liveCount} live</span><span className={error ? 'club-tv-warning' : 'club-tv-feed-state'} role="status">{error ? `${error}${feed ? ` Last updated ${timeLabel(feed.refreshedAt)}.` : ''}` : feed ? `Scores updated ${timeLabel(feed.refreshedAt)}` : 'Connecting to your club…'}</span></div>
    <div className="club-tv-content club-tv-centre">
      <section className="club-tv-fixtures" aria-label="Live scores and results">
        <div className="club-tv-section-head"><h2>Live scores &amp; results</h2><span>{liveCount} LIVE</span></div>
        <div className="club-tv-table-head"><span>STATUS</span><span>HOME</span><span>SCORE</span><span>AWAY</span></div>
        {visibleScores.map(({ match, status }) => <MatchRow key={match.id} match={match} status={status} showDate={period !== 'day'} clubLogo={club?.logoUrl || user.clubLogoUrl} />)}
        {!scores.length ? <div className="club-tv-empty"><h2>{denied ? 'Club access required' : feed ? period !== 'day' ? 'No matches in this period' : 'No live scores or results yet' : error ? 'Unable to load matches' : 'Loading your club’s matches'}</h2><p>{feed ? period !== 'day' ? 'Choose another date or period.' : 'Scores appear here when matches start.' : 'The display will reconnect automatically.'}</p></div> : null}
      </section>
      <section className="club-tv-home-panel" aria-label="Home fixtures">
        <div className="club-tv-section-head"><h2>{period === 'weekend' ? 'At home this weekend' : period === 'month' ? 'At home this month' : rangeView ? 'At home this week' : selectedToday ? 'At home today' : 'At home on this date'}</h2><small>KICK-OFF &amp; PITCH GUIDE</small></div>
        <div className={`club-tv-home-head${rangeView ? ' club-tv-home-row-week' : ''}`}><span>KO</span><span>TEAM / OPPOSITION</span><span>PITCH</span>{rangeView ? <span>DATE</span> : null}</div>
        {homeFixtures.slice(firstHome, firstHome + homePageSize).map(match => <HomeFixtureRow key={match.id} match={match} showDate={rangeView} clubLogo={club?.logoUrl || user.clubLogoUrl} />)}
        {!homeFixtures.length ? <p className="club-tv-home-empty">No home fixtures {period === 'weekend' ? 'this weekend' : period === 'month' ? 'this month' : rangeView ? 'this week' : selectedToday ? 'today' : 'on this date'}.</p> : null}
      </section>
      <aside className="club-tv-side-panel" aria-label="Club information">
        <section className={`club-tv-sponsor${sponsor ? ' club-tv-sponsor-artwork' : ''}`} aria-label="Club sponsors">{sponsor ? sponsorSlides.map((ad, index) => <ClubTvSponsorImage key={ad.imagePath ? `${ad.imagePath}:${index}` : index} ad={ad} clubId={user.clubId} slug={viewerSlug} hidden={ad !== sponsor} alt={ad.goalAlerts ? 'Free live goal alerts for grassroots football. Scan the QR code to get started.' : 'Club sponsor advert'} />) : <><small>PROUD TO SUPPORT YOUR CLUB</small><strong>Your company could advertise here.</strong><span>Ask the Club Admin about matchday sponsorship.</span></>}</section>
        {hasMap ? <section className="club-tv-pitch"><div><h2>Pitch map</h2><span>Find your pitch</span></div><img src={preferences.map} alt={`${club?.name || user.clubName || 'Club'} pitch map`} /></section> : null}
        {preferences.showPitchsideOrdering ? <section className="club-tv-ordering"><small>MATCHDAY PITCHSIDE</small><strong>Pitchside ordering</strong><span>Coming soon</span></section> : !hasMap ? <section className="club-tv-goal-alert-ad" aria-label="Free live goal alerts"><img src="/club-tv-goal-alerts.webp" alt="Free live goal alerts for grassroots football. Scan the QR code to get started." /></section> : null}
      </aside>
    </div>
    <RoadTicker matches={awayFixtures} clubLogo={club?.logoUrl || user.clubLogoUrl} showDate={rangeView} paused={paused} />
    <footer className="club-tv-footer"><div><span className="club-tv-live-dot" /> YOUR CLUB · EVERY TEAM <span className="club-tv-legend">● Goals <span className="club-tv-red">▮ Red cards</span> · Shirt numbers only</span></div><div className="club-tv-pages">Page {currentPage + 1} / {totalPages}{totalPages > 1 ? ` · ${paused ? 'Paused' : `Next in ${seconds}s`}` : ''}</div><BrandCredit /></footer>
    {!locked ? <nav className="club-tv-controls" aria-label="Display controls">{!standalone ? <Link to={preview ? "/club-matchday-tv/settings" : "/coach"}>Back to Club Admin</Link> : null}<label>Match date <input aria-label="Match date" type="date" value={date} onChange={(event) => { if (event.target.value) { setDate(event.target.value); setPeriod('day') } }} /></label><button aria-pressed={period === 'day' && date === clubTvDate(new Date(now))} onClick={() => { setDate(clubTvDate()); setPeriod('day') }}>Today</button>{[['weekend', 'Weekend'], ['week', 'Week'], ['month', 'Month']].map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}<button disabled={totalPages <= 1} onClick={() => changePage(-1)} aria-label="Previous match page">←</button><button disabled={totalPages <= 1} onClick={() => setPaused(!paused)}>{paused ? 'Resume carousel' : 'Pause carousel'}</button><button disabled={totalPages <= 1} onClick={() => changePage(1)} aria-label="Next match page">→</button><button onClick={fullScreen}>{standalone ? "Full screen" : "Full screen and lock"}</button>{fullscreenError ? <span role="status">{fullscreenError}</span> : null}</nav> : <div className="club-tv-lock-bar"><span>Display locked · Leaving full screen keeps Club Admin protected</span><button onClick={() => setUnlocking(true)}>Unlock Club Admin</button></div>}
    {unlocking ? <UnlockDisplay clubId={user.clubId} onClose={() => setUnlocking(false)} onUnlocked={async () => { setClubTvLocked(user, false); setLocked(false); setUnlocking(false); if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); navigate('/coach') }} /> : null}
    {goal && !denied ? <div role="status" className={preferences.bigGoal ? 'club-tv-goal-large' : 'club-tv-goal-small'}><div><small>{goal.event.side === 'club' ? goal.match.teamName : goal.match.opponent}</small><strong>GOAL!</strong><h2>{goal.event.shirt ? `#${goal.event.shirt}` : 'Goal scored'} {goal.event.minute == null ? '' : `· ${goal.event.minute}′`}</h2><p>{tvMatchSides(goal.match).home} <b>{goal.match.homeScore} : {goal.match.awayScore}</b> {tvMatchSides(goal.match).away}</p>{preferences.bigGoal ? <BrandCredit /> : null}</div></div> : null}
  </main>
}
