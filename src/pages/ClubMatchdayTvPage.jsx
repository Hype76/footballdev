import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { createThemeColorTokens } from '../lib/theme.js'
import { getClubMatchdayTv } from '../lib/domain/club-matchday-tv.js'
import { clubTvDate, newTvGoals, readTvPreferences, TV_PAGE_SIZE, TV_REFRESH_MS, TV_ROTATION_SECONDS, tvMatchSides, tvMatchStatus, tvPitchNumber } from '../lib/club-matchday-tv.js'
import fpLogo from '../assets/football-player-logo.webp'
import { isClubTvLocked, setClubTvLocked } from '../lib/club-tv-lock.js'
import './club-matchday-tv.css'

const timeLabel = (value) => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })
const dayLabel = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fixtureDayLabel = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

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
    <small>GROUND FORECAST</small>
    {forecast ? <><div className="club-tv-weather-reading"><WeatherIcon condition={forecast.condition} /><div className="club-tv-weather-details"><strong>{forecast.temperature}°C</strong><span>{forecast.condition.replace(/clearsky/g, 'Clear sky').replace(/partlycloudy/g, 'Partly cloudy').replace(/heavyrain/g, 'Heavy rain').replace(/lightrain/g, 'Light rain')}</span></div></div><span>{forecast.location} · Wind {forecast.windMph} mph</span><small className="club-tv-weather-source">{timeLabel(forecast.time)} · <a href="https://api.met.no/" target="_blank" rel="noreferrer">MET Norway</a></small></> : <span>{error || 'Loading ground weather…'}</span>}
  </div>
}

function EventLine({ events, side }) {
  return <div className="club-tv-events">{events.filter((event) => event.side === side).map((event) => <span key={event.id} className={event.type === 'red_card' ? 'club-tv-red' : ''}>
    <span aria-label={event.type === 'red_card' ? 'Red card' : 'Goal'}>{event.type === 'red_card' ? '▮' : '●'}</span> {event.shirt ? `#${event.shirt}` : ''}{event.minute == null ? '' : ` ${event.minute}${event.stoppage ? `+${event.stoppage}` : ''}′`}
  </span>)}</div>
}

function MatchRow({ match, status, clubLogo }) {
  const sides = tvMatchSides(match)
  const homeSide = sides.clubHome ? 'club' : 'opponent', awaySide = sides.clubHome ? 'opponent' : 'club'
  const started = status.kind !== 'upcoming'
  return <article className={`club-tv-match club-tv-${status.kind}`}>
    <div className="club-tv-match-meta"><strong>{status.label}</strong></div>
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
  return <div className="club-tv-road"><strong>ON THE ROAD</strong>{items.length ? <div className="club-tv-road-window"><div className="club-tv-road-track"><div>{items}</div>{!reducedMotion ? <div aria-hidden="true">{items}</div> : null}</div></div> : <span className="club-tv-road-empty">No away fixtures today</span>}{reducedMotion && matches.length > 1 ? <span className="club-tv-road-controls"><button aria-label="Previous away fixture" onClick={() => setIndex(current => (current - 1 + matches.length) % matches.length)}>‹</button><span>{index % matches.length + 1} / {matches.length}</span><button aria-label="Next away fixture" onClick={() => setIndex(current => (current + 1) % matches.length)}>›</button></span> : null}</div>
}

async function prepareTvArtwork(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const decoded = new Image()
  decoded.src = data
  await decoded.decode()
  if (!decoded.width || !decoded.height || decoded.width > 12000 || decoded.height > 12000) throw new Error('Invalid image dimensions')
  let scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height))
  const canvas = document.createElement('canvas')
  let image
  do {
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    canvas.getContext('2d').drawImage(decoded, 0, 0, canvas.width, canvas.height)
    image = canvas.toDataURL('image/webp', 0.88)
    scale *= 0.75
  } while (image.length >= 700000 && scale > 0.01)
  if (!image.startsWith('data:image/webp;base64,') || image.length >= 700000) throw new Error('Image cannot be saved')
  return image
}

function DisplaySettings({ preferences, onSave, onClose }) {
  const dialog = useRef(null)
  const [draft, setDraft] = useState(preferences)
  const [error, setError] = useState('')
  const [dragTarget, setDragTarget] = useState('')
  const [mapUploading, setMapUploading] = useState(false)
  const [sponsorsUploading, setSponsorsUploading] = useState(false)
  const uploadVersion = useRef(0)
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close() }, [])
  async function upload(file) {
    const version = ++uploadVersion.current
    if (!file) { setMapUploading(false); return }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setMapUploading(false); setError('Choose a PNG, JPG or WebP image up to 5 MB.'); return }
    setMapUploading(true)
    try {
      const data = await prepareTvArtwork(file)
      if (version === uploadVersion.current) { setDraft((current) => ({ ...current, map: data, showMap: true })); setError('') }
    } catch { if (version === uploadVersion.current) setError('This image could not be opened. Try a smaller PNG, JPG or WebP.') }
    finally { if (version === uploadVersion.current) setMapUploading(false) }
  }
  async function uploadSponsors(files) {
    if (sponsorsUploading) return
    const incoming = [...files].slice(0, Math.max(0, 3 - draft.sponsorAds.length))
    if (!incoming.length) return
    if (incoming.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError('Each sponsor image must be PNG, JPG or WebP and up to 5 MB.')
      return
    }
    setSponsorsUploading(true)
    try {
      const ads = await Promise.all(incoming.map(async file => {
        const image = await prepareTvArtwork(file)
        return { image, name: '' }
      }))
      setDraft(current => ({ ...current, sponsorAds: [...current.sponsorAds, ...ads].slice(0, 3) }))
      setError('')
    } catch { setError('The sponsor images could not be opened. Try another PNG, JPG or WebP.') }
    finally { setSponsorsUploading(false) }
  }
  function dropFiles(event, target) {
    event.preventDefault()
    setDragTarget('')
    if (target === 'map') void upload(event.dataTransfer.files?.[0])
    else void uploadSponsors(event.dataTransfer.files || [])
  }
  return <dialog ref={dialog} className="club-tv-settings" onCancel={onClose} aria-labelledby="club-tv-settings-title">
    <form onSubmit={(event) => { event.preventDefault(); try { onSave(draft) } catch { setError('Settings could not be saved. Try a smaller map or free some browser storage.') } }}>
      <h2 id="club-tv-settings-title">Display settings</h2>
      <p>For this club on this browser. Scores use your club’s live Match Day records.</p>
      <label>Appearance <select aria-label="Appearance" value={draft.appearance} onChange={(event) => setDraft({ ...draft, appearance: event.target.value })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Club ground postcode <input value={draft.weatherPostcode} maxLength={10} placeholder="e.g. CB23 6FY" onChange={(event) => setDraft({ ...draft, weatherPostcode: event.target.value.toUpperCase() })} /></label>
      <small>Weather uses this ground, wherever the screen is running. Great Britain postcodes supported.</small>
      <label className="club-tv-check"><input type="checkbox" checked={draft.bigGoal} onChange={(event) => setDraft({ ...draft, bigGoal: event.target.checked })} /> Large goal celebration</label>
      <small>Switch off for a small goal popup. All celebrations are silent.</small>
      <label className={`club-tv-upload${dragTarget === 'map' ? ' club-tv-upload-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragTarget('map') }} onDragLeave={() => setDragTarget('')} onDrop={(event) => dropFiles(event, 'map')}>Pitch map <span>Drag and drop or click to upload</span><input aria-label="Pitch map" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} /></label>
      <small>PNG, JPG or WebP, up to 5 MB. The map stays beside the rotating scores.</small>
      {draft.map ? <><img className="club-tv-map-preview" src={draft.map} alt="Uploaded pitch map preview" /><label className="club-tv-check"><input type="checkbox" checked={draft.showMap} onChange={(event) => setDraft({ ...draft, showMap: event.target.checked })} /> Show map on half the display</label><button type="button" onClick={() => { uploadVersion.current++; setMapUploading(false); setDraft({ ...draft, map: '' }) }}>Remove map</button></> : null}
      <label className={`club-tv-upload${dragTarget === 'sponsor' ? ' club-tv-upload-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragTarget('sponsor') }} onDragLeave={() => setDragTarget('')} onDrop={(event) => dropFiles(event, 'sponsor')}>Sponsor artwork <span>Drag and drop or click to upload</span><input aria-label="Sponsor artwork" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={sponsorsUploading} onChange={(event) => { void uploadSponsors(event.target.files || []); event.target.value = '' }} /></label>
      <small>Add up to three sponsor adverts. Each image can be up to 5 MB. They rotate on this club display.</small>
      {draft.sponsorAds.map((ad, index) => <div className="club-tv-sponsor-edit" key={index}><img src={ad.image} alt={`Sponsor ${index + 1} preview`} /><button type="button" aria-label={`Remove sponsor ${index + 1}`} onClick={() => setDraft(current => ({ ...current, sponsorAds: current.sponsorAds.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button></div>)}
      <label className="club-tv-check"><input type="checkbox" checked={draft.showPitchsideOrdering} onChange={(event) => setDraft({ ...draft, showPitchsideOrdering: event.target.checked })} /> Show pitchside ordering</label>
      <small>When enabled, the display says Coming soon until ordering is available.</small>
      {error ? <p role="alert">{error}</p> : null}
      <div className="club-tv-settings-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={mapUploading || sponsorsUploading}>Save settings</button></div>
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
    <h2 id="club-tv-unlock-title">Unlock Club Admin</h2><p>Enter your own Club Admin password to leave the match display. Your password is never saved or logged by the app. This box closes after 2 minutes and keeps the display locked.</p>
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
  const [capacity, setCapacity] = useState(TV_PAGE_SIZE)
  const [homeCapacity, setHomeCapacity] = useState(6)
  const [viewportVersion, setViewportVersion] = useState(0)
  const hasMap = !denied && Boolean(preferences.showMap && preferences.map)
  const pageSize = Math.min(TV_PAGE_SIZE, capacity)
  const homePageSize = homeCapacity
  const [now, setNow] = useState(Date.now)
  const [page, setPage] = useState(0)
  const [sponsorIndex, setSponsorIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(TV_ROTATION_SECONDS)
  const [settings, setSettings] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [goals, setGoals] = useState([])
  const [locked, setLocked] = useState(() => isClubTvLocked(user))
  const [unlocking, setUnlocking] = useState(false)
  useEffect(() => {
    if (!unlocking) return
    const timeout = setTimeout(() => setUnlocking(false), 120000)
    return () => clearTimeout(timeout)
  }, [unlocking])
  const root = useRef(null)
  const weekAhead = feed?.window?.kind === 'week'
  const fixtures = (feed?.matches || []).map(match => ({ match, status: tvMatchStatus(match) }))
  const scores = fixtures.filter(({ status }) => status.kind === 'live' || status.kind === 'finished')
  const liveCount = scores.filter(({ status }) => status.kind === 'live').length
  if (!weekAhead) scores.push(...fixtures.filter(({ status }) => status.kind === 'upcoming'))
  const homeFixtures = (feed?.matches || []).filter(match => match.homeAway !== 'away')
  const awayFixtures = (feed?.matches || []).filter(match => match.homeAway === 'away')
  const scorePages = Math.max(1, Math.ceil(scores.length / pageSize))
  const homePages = Math.max(1, Math.ceil(homeFixtures.length / homePageSize))
  const totalPages = Math.max(scorePages, homePages)
  const currentPage = Math.min(page, totalPages - 1)
  const goal = goals[0]
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
  }, [feed, currentPage, pageSize, homePageSize, hasMap, viewportVersion])
  useEffect(() => {
    const resize = () => { setCapacity(TV_PAGE_SIZE); setHomeCapacity(6); setViewportVersion((version) => version + 1) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
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
        const fresh = newTvGoals(previous, result.matches).filter(({ event, match }) => match.matchDate === date && !seen.has(event.id))
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
    if (preferences.sponsorAds.length < 2) return undefined
    const timer = setInterval(() => { if (!document.hidden && !paused) setSponsorIndex(current => (current + 1) % preferences.sponsorAds.length) }, TV_ROTATION_SECONDS * 1000)
    return () => clearInterval(timer)
  }, [paused, preferences.sponsorAds])
  useEffect(() => {
    if (!goal) return
    const timer = setTimeout(() => setGoals((queue) => queue.slice(1)), 7000)
    return () => clearTimeout(timer)
  }, [goal])
  const club = feed?.club
  const theme = createThemeColorTokens(club?.accent || user.themeAccent || 'green', preferences.appearance)
  const changePage = (direction) => { setPage((currentPage + direction + totalPages) % totalPages); setSeconds(TV_ROTATION_SECONDS) }
  async function fullScreen() {
    try {
      setClubTvLocked(user, true); setLocked(true)
      if (document.fullscreenElement) await document.exitFullscreen()
      else await root.current.requestFullscreen()
      setFullscreenError('')
    } catch { setFullscreenError('Full screen is unavailable in this browser. Use your browser’s full screen option.') }
  }
  return <main ref={root} className={`club-tv club-tv-${preferences.appearance} ${hasMap ? 'club-tv-split' : ''}`} style={{ '--tv-accent': theme.accent, '--tv-accent-text': theme.accentText, '--tv-accent-readable': theme.textSecondary, '--tv-soft': theme.accentSoft }}>
    <header className="club-tv-header"><div className="club-tv-identity"><img src={club?.logoUrl || user.clubLogoUrl || fpLogo} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fpLogo }} /><div><small>WELCOME TO</small><h1>{club?.name || user.clubName || 'Your club'}</h1></div></div>
      {!denied ? <GroundWeather key={preferences.weatherPostcode} clubId={user.clubId} postcode={preferences.weatherPostcode} /> : null}
      <div className="club-tv-clock"><strong>{timeLabel(now)}</strong><span>{new Date(now).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' })} · UK time</span></div>
    </header>
    <div className="club-tv-day"><h2>{weekAhead ? 'Week ahead' : dayLabel(date)}</h2>{weekAhead ? <span className="club-tv-period">{fixtureDayLabel(feed.window.startDate)} to {fixtureDayLabel(feed.window.endDate)}</span> : null}<span>{fixtures.length} matches · {liveCount} live</span><span className={error ? 'club-tv-warning' : 'club-tv-feed-state'} role="status">{error ? `${error}${feed ? ` Last updated ${timeLabel(feed.refreshedAt)}.` : ''}` : feed ? `Scores updated ${timeLabel(feed.refreshedAt)}` : 'Connecting to your club…'}</span></div>
    <div className="club-tv-content club-tv-centre">
      <section className="club-tv-fixtures" aria-label="Live scores and results">
        <div className="club-tv-section-head"><h2>Live scores &amp; results</h2><span>{liveCount} LIVE</span></div>
        <div className="club-tv-table-head"><span>STATUS</span><span>HOME</span><span>SCORE</span><span>AWAY</span></div>
        {scores.slice((currentPage % scorePages) * pageSize, ((currentPage % scorePages) + 1) * pageSize).map(({ match, status }) => <MatchRow key={match.id} match={match} status={status} clubLogo={club?.logoUrl || user.clubLogoUrl} />)}
        {!scores.length ? <div className="club-tv-empty"><h2>{denied ? 'Club access required' : feed ? 'No live scores or results yet' : error ? 'Unable to load matches' : 'Loading your club’s matches'}</h2><p>{feed ? 'Scores appear here when matches start.' : 'The display will reconnect automatically.'}</p></div> : null}
      </section>
      <section className="club-tv-home-panel" aria-label="At home today">
        <div className="club-tv-section-head"><h2>{weekAhead ? 'At home this week' : 'At home today'}</h2><small>KICK-OFF &amp; PITCH GUIDE</small></div>
        <div className={`club-tv-home-head${weekAhead ? ' club-tv-home-row-week' : ''}`}><span>KO</span><span>TEAM / OPPOSITION</span><span>PITCH</span>{weekAhead ? <span>DATE</span> : null}</div>
        {homeFixtures.slice((currentPage % homePages) * homePageSize, ((currentPage % homePages) + 1) * homePageSize).map(match => <HomeFixtureRow key={match.id} match={match} showDate={weekAhead} clubLogo={club?.logoUrl || user.clubLogoUrl} />)}
        {!homeFixtures.length ? <p className="club-tv-home-empty">No home fixtures {weekAhead ? 'this week' : 'today'}.</p> : null}
      </section>
      <aside className="club-tv-side-panel" aria-label="Club information">
        <section className={`club-tv-sponsor${preferences.sponsorAds.length ? ' club-tv-sponsor-artwork' : ''}`} aria-label="Club sponsors">{preferences.sponsorAds.length ? <img src={preferences.sponsorAds[sponsorIndex % preferences.sponsorAds.length].image} alt="Club sponsor advert" /> : <><small>PROUD TO SUPPORT YOUR CLUB</small><strong>Your company could advertise here.</strong><span>Ask the Club Admin about matchday sponsorship.</span></>}</section>
        {hasMap ? <section className="club-tv-pitch"><div><h2>Pitch map</h2><span>Find your pitch</span></div><img src={preferences.map} alt={`${club?.name || user.clubName || 'Club'} pitch map`} /></section> : null}
        {preferences.showPitchsideOrdering ? <section className="club-tv-ordering"><small>MATCHDAY PITCHSIDE</small><strong>Pitchside ordering</strong><span>Coming soon</span></section> : <section className="club-tv-goal-alert-ad" aria-label="Free live goal alerts"><img src="/club-tv-goal-alerts.webp" alt="Free live goal alerts for grassroots football. Scan the QR code to get started." /></section>}
      </aside>
    </div>
    <RoadTicker matches={awayFixtures} clubLogo={club?.logoUrl || user.clubLogoUrl} showDate={weekAhead} paused={paused} />
    <footer className="club-tv-footer"><div><span className="club-tv-live-dot" /> YOUR CLUB · EVERY TEAM <span className="club-tv-legend">● Goals <span className="club-tv-red">▮ Red cards</span> · Shirt numbers only</span></div><div className="club-tv-pages">Page {currentPage + 1} / {totalPages}{totalPages > 1 ? ` · ${paused ? 'Paused' : `Next in ${seconds}s`}` : ''}</div><BrandCredit /></footer>
    {!locked ? <nav className="club-tv-controls" aria-label="Display controls"><Link to="/coach">Back to Club Admin</Link><label>Match date <input aria-label="Match date" type="date" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value) }} /></label><button onClick={() => setDate(clubTvDate())}>Today</button><button disabled={totalPages <= 1} onClick={() => changePage(-1)} aria-label="Previous match page">←</button><button disabled={totalPages <= 1} onClick={() => setPaused(!paused)}>{paused ? 'Resume carousel' : 'Pause carousel'}</button><button disabled={totalPages <= 1} onClick={() => changePage(1)} aria-label="Next match page">→</button><button onClick={() => setSettings(true)}>Display settings</button><button onClick={fullScreen}>Full screen and lock</button>{fullscreenError ? <span role="status">{fullscreenError}</span> : null}</nav> : <div className="club-tv-lock-bar"><span>Display locked · Leaving full screen keeps Club Admin protected</span><button onClick={() => setUnlocking(true)}>Unlock Club Admin</button></div>}
    {unlocking ? <UnlockDisplay clubId={user.clubId} onClose={() => setUnlocking(false)} onUnlocked={async () => { setClubTvLocked(user, false); setLocked(false); setUnlocking(false); if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); navigate('/coach') }} /> : null}
    {settings ? <DisplaySettings preferences={preferences} onClose={() => setSettings(false)} onSave={(value) => { localStorage.setItem(storageKey, JSON.stringify(value)); setPreferences(value); setSettings(false) }} /> : null}
    {goal && !denied ? <div role="status" className={preferences.bigGoal ? 'club-tv-goal-large' : 'club-tv-goal-small'}><div><small>{goal.event.side === 'club' ? goal.match.teamName : goal.match.opponent}</small><strong>GOAL!</strong><h2>{goal.event.shirt ? `#${goal.event.shirt}` : 'Goal scored'} {goal.event.minute == null ? '' : `· ${goal.event.minute}′`}</h2><p>{tvMatchSides(goal.match).home} <b>{goal.match.homeScore} : {goal.match.awayScore}</b> {tvMatchSides(goal.match).away}</p>{preferences.bigGoal ? <BrandCredit /> : null}</div></div> : null}
  </main>
}
