import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { createThemeColorTokens } from '../lib/theme.js'
import { getClubMatchdayTv } from '../lib/domain/club-matchday-tv.js'
import { clubTvDate, newTvGoals, readTvPreferences, TV_PAGE_SIZE, TV_REFRESH_MS, TV_ROTATION_SECONDS, tvMatchSides, tvMatchStatus } from '../lib/club-matchday-tv.js'
import fpLogo from '../assets/football-player-logo.webp'
import { isClubTvLocked, setClubTvLocked } from '../lib/club-tv-lock.js'
import './club-matchday-tv.css'

const timeLabel = (value) => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })
const dayLabel = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function BrandCredit() {
  return <div className="club-tv-credit"><img src={fpLogo} alt="Football Player" /><span>footballplayer.online</span></div>
}

function GroundWeather({ clubId, postcode }) {
  const [forecast, setForecast] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!postcode) return
    let active = true, busy = false
    let controller
    async function refresh() {
      if (busy || document.hidden) return
      busy = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      try {
        const result = await getClubMatchdayTv({ clubId, action: 'weather', postcode, signal: controller.signal })
        if (active) { setForecast(result.weather); setError('') }
      } catch {
        if (active) { setForecast(null); setError('Ground weather unavailable') }
      } finally { clearTimeout(timeout); busy = false }
    }
    refresh()
    const timer = setInterval(refresh, 15 * 60000)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [clubId, postcode])
  if (!postcode) return <div className="club-tv-weather"><small>LOCAL WEATHER</small><span>Add your ground postcode in Display settings</span></div>
  return <div className="club-tv-weather" aria-label="Club ground weather">
    <small>GROUND FORECAST {forecast ? `· ${timeLabel(forecast.time)} · ` : ''}{forecast ? <a href="https://api.met.no/" target="_blank" rel="noreferrer">MET Norway</a> : null}</small>
    {forecast ? <><strong>{forecast.temperature}°C <span>{forecast.condition}</span></strong><span>{forecast.location} · Wind {forecast.windMph} mph</span></> : <span>{error || 'Loading ground weather…'}</span>}
  </div>
}

function EventLine({ events, side }) {
  return <div className="club-tv-events">{events.filter((event) => event.side === side).map((event) => <span key={event.id} className={event.type === 'red_card' ? 'club-tv-red' : ''}>
    <span aria-label={event.type === 'red_card' ? 'Red card' : 'Goal'}>{event.type === 'red_card' ? '▮' : '●'}</span> {event.shirt ? `#${event.shirt}` : ''}{event.minute == null ? '' : ` ${event.minute}${event.stoppage ? `+${event.stoppage}` : ''}′`}
  </span>)}</div>
}

function MatchRow({ match, now }) {
  const sides = tvMatchSides(match), status = tvMatchStatus(match, now)
  const homeSide = sides.clubHome ? 'club' : 'opponent', awaySide = sides.clubHome ? 'opponent' : 'club'
  return <article className={`club-tv-match club-tv-${status.kind}`}>
    <div className="club-tv-match-meta"><strong>{status.label}</strong><span>{match.venue || (match.homeAway === 'away' ? 'Away' : 'Home')}</span></div>
    <div className={`club-tv-team club-tv-home ${sides.clubHome ? 'club-tv-own' : ''}`}><strong>{sides.home}</strong><EventLine events={match.events} side={homeSide} /></div>
    <div className="club-tv-score"><strong>{status.kind === 'upcoming' ? 'v' : `${match.homeScore} : ${match.awayScore}`}</strong>{(match.status === 'penalties' || match.homeShootoutScore || match.awayShootoutScore) ? <small>PENS {match.homeShootoutScore} : {match.awayShootoutScore}</small> : null}</div>
    <div className={`club-tv-team ${!sides.clubHome ? 'club-tv-own' : ''}`}><strong>{sides.away}</strong><EventLine events={match.events} side={awaySide} /></div>
  </article>
}

function DisplaySettings({ preferences, onSave, onClose }) {
  const dialog = useRef(null)
  const [draft, setDraft] = useState(preferences)
  const [error, setError] = useState('')
  const uploadVersion = useRef(0)
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close() }, [])
  async function upload(file) {
    const version = ++uploadVersion.current
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError('Choose a PNG, JPG or WebP image up to 2 MB.'); return }
    try {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
      const image = new Image()
      image.src = data
      await image.decode()
      if (image.width > 12000 || image.height > 12000) throw new Error('Image too large')
      if (version === uploadVersion.current) { setDraft((current) => ({ ...current, map: data, showMap: true })); setError('') }
    } catch { setError('This image could not be opened. Try a smaller PNG, JPG or WebP.') }
  }
  return <dialog ref={dialog} className="club-tv-settings" onCancel={onClose} aria-labelledby="club-tv-settings-title">
    <form onSubmit={(event) => { event.preventDefault(); try { onSave(draft) } catch { setError('Settings could not be saved. Try a smaller map or free some browser storage.') } }}>
      <h2 id="club-tv-settings-title">Display settings</h2>
      <p>For this club on this browser. Scores use your club’s live Match Day records.</p>
      <label>Club ground postcode <input value={draft.weatherPostcode} maxLength={10} placeholder="e.g. CB23 6FY" onChange={(event) => setDraft({ ...draft, weatherPostcode: event.target.value.toUpperCase() })} /></label>
      <small>Weather uses this ground, wherever the screen is running. Great Britain postcodes supported.</small>
      <label className="club-tv-check"><input type="checkbox" checked={draft.bigGoal} onChange={(event) => setDraft({ ...draft, bigGoal: event.target.checked })} /> Large goal celebration</label>
      <small>Switch off for a small goal popup. All celebrations are silent.</small>
      <label>Pitch map <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => upload(event.target.files?.[0])} /></label>
      <small>PNG, JPG or WebP, up to 2 MB. The map stays beside the rotating scores.</small>
      {draft.map ? <><img className="club-tv-map-preview" src={draft.map} alt="Uploaded pitch map preview" /><label className="club-tv-check"><input type="checkbox" checked={draft.showMap} onChange={(event) => setDraft({ ...draft, showMap: event.target.checked })} /> Show map on half the display</label><button type="button" onClick={() => { uploadVersion.current++; setDraft({ ...draft, map: '' }) }}>Remove map</button></> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="club-tv-settings-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit">Save settings</button></div>
      <small>Forecast: <a href="https://api.met.no/" target="_blank" rel="noreferrer">MET Norway</a>, CC BY 4.0. Postcodes: <a href="https://postcodes.io/docs/licences/" target="_blank" rel="noreferrer">OS OpenData and ONS</a>. Contains OS data and National Statistics data © Crown copyright and database right {new Date().getFullYear()}. Contains Royal Mail data © Royal Mail copyright and database right {new Date().getFullYear()}.</small>
    </form>
  </dialog>
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
    <h2 id="club-tv-unlock-title">Unlock Club Admin</h2><p>Enter your own Club Admin password to leave the match display. Your password is never saved or logged by the app.</p>
    <label>Club Admin password <input ref={passwordInput} type="password" name="display-unlock-password" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={1024} disabled={busy} /></label>
    {error ? <p role="alert">{error}</p> : null}<div className="club-tv-settings-actions"><button type="button" onClick={onClose}>Keep display locked</button><button disabled={busy} type="submit">{busy ? 'Checking…' : 'Unlock and return'}</button></div>
  </form></dialog>
}

export function ClubMatchdayTvPage() {
  const { user } = useAuth()
  return <ClubDisplay key={`${user.id}:${user.clubId}`} user={user} />
}

function ClubDisplay({ user }) {
  const [date, setDate] = useState(() => clubTvDate())
  useEffect(() => {
    let today = clubTvDate()
    const timer = setInterval(() => {
      const next = clubTvDate()
      if (next !== today) { const previous = today; today = next; setDate((selected) => selected === previous ? next : selected) }
    }, 30000)
    return () => clearInterval(timer)
  }, [])
  return <ClubDayDisplay key={date} user={user} date={date} setDate={setDate} />
}

function ClubDayDisplay({ user, date, setDate }) {
  const navigate = useNavigate()
  const storageKey = `fp:club-matchday-tv:${user.id}:${user.clubId}`
  const [preferences, setPreferences] = useState(() => readTvPreferences(storageKey))
  const [feed, setFeed] = useState(null)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [page, setPage] = useState(0)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(TV_ROTATION_SECONDS)
  const [settings, setSettings] = useState(false)
  const [tvMode, setTvMode] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [goals, setGoals] = useState([])
  const [locked, setLocked] = useState(() => isClubTvLocked(user))
  const [unlocking, setUnlocking] = useState(false)
  const root = useRef(null)
  const totalPages = Math.max(1, Math.ceil((feed?.matches.length || 0) / TV_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const goal = goals[0]
  useEffect(() => {
    let active = true, busy = false, previous = null, controller, revoked = false
    const seen = new Set()
    async function refresh() {
      if (busy || document.hidden || revoked) return
      busy = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        const result = await getClubMatchdayTv({ clubId: user.clubId, date, signal: controller.signal })
        if (!active) return
        const fresh = newTvGoals(previous, result.matches).filter(({ event }) => !seen.has(event.id))
        for (const match of result.matches) for (const event of match.events) seen.add(event.id)
        if (fresh.length && date === clubTvDate()) setGoals((queue) => [...queue, ...fresh].slice(0, 10))
        previous = result.matches
        setFeed(result); setError('')
      } catch (failure) {
        previous = null
        if (!active) return
        setGoals([])
        if ([401, 403].includes(failure.status)) { revoked = true; setFeed(null); setDenied(true) }
        setError(failure.message || 'Scores could not be refreshed.')
      } finally { clearTimeout(timeout); busy = false }
    }
    refresh()
    const timer = setInterval(refresh, TV_REFRESH_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [date, user.clubId])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    const timer = setInterval(() => {
      if (paused || settings || goal || document.hidden || totalPages <= 1) return
      setSeconds((value) => { if (value <= 1) return TV_ROTATION_SECONDS; return value - 1 })
    }, 1000)
    return () => clearInterval(timer)
  }, [paused, settings, goal, totalPages])
  const previousSeconds = useRef(seconds)
  useEffect(() => {
    if (previousSeconds.current === 1 && seconds === TV_ROTATION_SECONDS) setPage((value) => (value + 1) % totalPages)
    previousSeconds.current = seconds
  }, [seconds, totalPages])
  useEffect(() => {
    if (!goal) return
    const timer = setTimeout(() => setGoals((queue) => queue.slice(1)), 7000)
    return () => clearTimeout(timer)
  }, [goal])
  useEffect(() => {
    function keydown(event) { if (event.key === 'Escape') setTvMode(false) }
    function fullscreenchange() { if (!document.fullscreenElement) setTvMode(false) }
    document.addEventListener('keydown', keydown)
    document.addEventListener('fullscreenchange', fullscreenchange)
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('fullscreenchange', fullscreenchange) }
  }, [])
  const club = feed?.club
  const theme = createThemeColorTokens(club?.accent || user.themeAccent || 'green', 'dark')
  const hasMap = !denied && Boolean(preferences.showMap && preferences.map)
  const changePage = (direction) => { setPage((currentPage + direction + totalPages) % totalPages); setSeconds(TV_ROTATION_SECONDS) }
  async function fullScreen() {
    try {
      setClubTvLocked(user, true); setLocked(true)
      if (document.fullscreenElement) await document.exitFullscreen()
      else { await root.current.requestFullscreen(); setTvMode(true) }
      setFullscreenError('')
    } catch { setFullscreenError('Full screen is unavailable in this browser. Use your browser’s full screen option.') }
  }
  return <main ref={root} className={`club-tv ${hasMap ? 'club-tv-split' : ''} ${tvMode ? 'club-tv-mode' : ''}`} style={{ '--tv-accent': theme.accent, '--tv-accent-text': theme.accentText, '--tv-accent-readable': theme.textSecondary, '--tv-soft': theme.accentSoft }}>
    <header className="club-tv-header"><div className="club-tv-identity"><img src={club?.logoUrl || user.clubLogoUrl || fpLogo} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fpLogo }} /><div><small>CLUB MATCHDAY</small><h1>{club?.name || user.clubName || 'Your club'}</h1></div></div>
      {!denied ? <GroundWeather key={preferences.weatherPostcode} clubId={user.clubId} postcode={preferences.weatherPostcode} /> : null}
      <div className="club-tv-clock"><strong>{timeLabel(now)}</strong><span>{new Date(now).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' })} · UK time</span></div>
    </header>
    <div className="club-tv-day"><h2>{dayLabel(date)}</h2><span>{feed?.matches.length ?? 0} matches · {feed?.matches.filter((match) => tvMatchStatus(match, now).kind === 'live').length ?? 0} live</span><span className={error ? 'club-tv-warning' : 'club-tv-feed-state'} role="status">{error ? `${error}${feed ? ` Last updated ${timeLabel(feed.refreshedAt)}.` : ''}` : feed ? `Scores updated ${timeLabel(feed.refreshedAt)}` : 'Connecting to your club…'}</span></div>
    <div className="club-tv-content"><section className="club-tv-fixtures" aria-label="Your club matches">
      <div className="club-tv-table-head"><span>MATCH STATUS</span><span>HOME</span><span>SCORE</span><span>AWAY</span></div>
      {feed?.matches.slice(currentPage * TV_PAGE_SIZE, (currentPage + 1) * TV_PAGE_SIZE).map((match) => <MatchRow key={match.id} match={match} now={now} />)}
      {!feed?.matches.length ? <div className="club-tv-empty"><h2>{denied ? 'Club access required' : feed ? 'No matches on this date' : error ? 'Unable to load matches' : 'Loading your club’s matches'}</h2><p>{denied ? 'Return to Club Admin and sign in to your active club workspace.' : feed ? 'Matches added by your teams in Match Day will appear here.' : 'The display will reconnect automatically.'}</p></div> : null}
    </section>{hasMap ? <aside className="club-tv-pitch"><div><h2>Pitch map</h2><span>Find your pitch</span></div><img src={preferences.map} alt={`${club?.name || user.clubName || 'Club'} pitch map`} /></aside> : null}</div>
    <footer className="club-tv-footer"><div><span className="club-tv-live-dot" /> YOUR CLUB · EVERY TEAM <span className="club-tv-legend">● Goals <span className="club-tv-red">▮ Red cards</span> · Shirt numbers only</span></div><div className="club-tv-pages">Page {currentPage + 1} / {totalPages}{totalPages > 1 ? ` · ${paused ? 'Paused' : `Next in ${seconds}s`}` : ''}</div><BrandCredit /></footer>
    {!locked ? <nav className="club-tv-controls" aria-label="Display controls"><Link to="/coach">Back to Club Admin</Link><label>Match date <input aria-label="Match date" type="date" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value) }} /></label><button onClick={() => setDate(clubTvDate())}>Today</button><button disabled={totalPages <= 1} onClick={() => changePage(-1)} aria-label="Previous match page">←</button><button disabled={totalPages <= 1} onClick={() => setPaused(!paused)}>{paused ? 'Resume carousel' : 'Pause carousel'}</button><button disabled={totalPages <= 1} onClick={() => changePage(1)} aria-label="Next match page">→</button><button onClick={() => setSettings(true)}>Display settings</button><button onClick={fullScreen}>Full screen and lock</button><button onClick={() => setTvMode(!tvMode)}>{tvMode ? 'Show controls' : 'TV mode'}</button>{fullscreenError ? <span role="status">{fullscreenError}</span> : null}</nav> : <div className="club-tv-lock-bar"><span>Display locked · Leaving full screen keeps Club Admin protected</span><button onClick={() => setUnlocking(true)}>Unlock Club Admin</button></div>}
    {tvMode && !locked ? <button className="club-tv-restore" onClick={() => setTvMode(false)}>Show controls</button> : null}
    {unlocking ? <UnlockDisplay clubId={user.clubId} onClose={() => setUnlocking(false)} onUnlocked={async () => { setClubTvLocked(user, false); setLocked(false); setUnlocking(false); if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); navigate('/coach') }} /> : null}
    {settings ? <DisplaySettings preferences={preferences} onClose={() => setSettings(false)} onSave={(value) => { localStorage.setItem(storageKey, JSON.stringify(value)); setPreferences(value); setSettings(false) }} /> : null}
    {goal && !denied ? <div role="status" className={preferences.bigGoal ? 'club-tv-goal-large' : 'club-tv-goal-small'}><div><small>{goal.event.side === 'club' ? goal.match.teamName : goal.match.opponent}</small><strong>GOAL!</strong><h2>{goal.event.shirt ? `#${goal.event.shirt}` : 'Goal scored'} {goal.event.minute == null ? '' : `· ${goal.event.minute}′`}</h2><p>{tvMatchSides(goal.match).home} <b>{goal.match.homeScore} : {goal.match.awayScore}</b> {tvMatchSides(goal.match).away}</p>{preferences.bigGoal ? <BrandCredit /> : null}</div></div> : null}
  </main>
}
