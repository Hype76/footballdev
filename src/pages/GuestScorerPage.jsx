import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getParentScorerTimerActions } from '../lib/matchday-lifecycle.js'
import { captureMatchEventTime, formatMatchAddedTimeClock, getMatchClockDescription } from '../lib/matchday-event-time.js'
import { getMatchDayDisplayName } from '../lib/matchday-display.js'
import { getGuestTimerRequest, newGuestSecret, requestGuestScorer } from '../lib/guest-scorer.js'
import { getGoalScorerSide, setGoalOwnGoal } from '../lib/matchday-goal-credit.js'
import { getThemeColorVariableStyle } from '../lib/theme.js'
import { usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'
import footballPlayerLogo from '../assets/football-player-logo.webp'
import { validateScorerMatchEvent } from '../lib/matchday-scorer-event.js'
import './guest-scorer.css'

const storageKey = 'fp-guest-scorer'
function readSession() {
  try {
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite')
    let session = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (invite && /^[a-f0-9]{64}$/.test(invite)) {
      if (session?.invite !== invite) session = { invite, token: newGuestSecret(), expires: Date.now() + 8 * 60 * 60 * 1000 }
      localStorage.setItem(storageKey, JSON.stringify(session))
      history.replaceState(null, '', location.pathname)
    }
    if (!session || session.expires < Date.now()) { localStorage.removeItem(storageKey); return null }
    return session
  } catch { return null }
}
function Person({ title, name, shirt, players, onChange, disabled, selectedOnly = false }) {
  const selectedIndex = players.findIndex((player) => player.name === name && String(player.shirtNumber || '') === String(shirt || ''))
  return <fieldset disabled={disabled}><legend>{title}</legend>
    {players.length > 0 ? <select aria-label={title + ' selection'} value={selectedIndex < 0 ? '' : String(selectedIndex)} onChange={(event) => {
      if (event.target.value === '') { onChange('', ''); return }
      const player = players[Number(event.target.value)]
      if (player) onChange(player.name, player.shirtNumber || '')
    }}><option value="">{selectedOnly ? 'Choose player from the match squad' : 'Choose player or enter another name'}</option>{players.map((player, index) => <option key={index} value={String(index)}>{player.name}{player.shirtNumber ? ' | Shirt ' + player.shirtNumber : ''}</option>)}</select> : selectedOnly ? <p>Ask the coach to select the match squad first.</p> : null}
    {selectedIndex >= 0 ? <p className="gs-selection" role="status">Selected: {players[selectedIndex].name}</p> : null}
    {!selectedOnly ? <><input aria-label={title + ' name'} value={name || ''} maxLength={80} placeholder={title === 'Assist' ? 'No assist, or enter a name' : 'Player name'} onChange={(event) => onChange(event.target.value, shirt)} />
    <input aria-label={title + ' shirt number'} value={shirt || ''} maxLength={8} placeholder="Shirt number, optional" onChange={(event) => onChange(name, event.target.value)} /></> : null}
  </fieldset>
}
function GoalEditor({ goal, setGoal, players, onSave, onRemove, onClose, busy }) {
  const update = (change) => setGoal((prior) => ({ ...prior, ...change }))
  const scorerPlayers = getGoalScorerSide(goal) === 'club' ? players : []
  return <div className="gs-backdrop"><section className="gs-sheet" role="dialog" aria-modal="true" aria-label={goal.eventId ? 'Correct goal' : 'Add goal'}>
    <header><h2>{goal.eventId ? 'Correct goal' : 'Add goal'}</h2><button disabled={busy} onClick={onClose}>Close</button></header>
    <form onSubmit={(event) => { event.preventDefault(); onSave(goal) }}>
      <label>Goal awarded to<select value={goal.teamSide} onChange={(event) => update({ teamSide: event.target.value, scorerName: '', scorerShirtNumber: '', assistName: '', assistShirtNumber: '' })}><option value="club">Our team</option><option value="opponent">Opponent</option></select></label>
      <label className="gs-check"><input type="checkbox" checked={goal.isOwnGoal || false} onChange={(event) => setGoal((prior) => setGoalOwnGoal(prior, event.target.checked))} />Own goal</label>
      {goal.isOwnGoal ? <p className="gs-selection">{getGoalScorerSide(goal) === 'club' ? 'Our player scored an own goal. The opponent receives the goal.' : 'An opponent scored an own goal. Our team receives the goal.'}</p> : null}
      <Person title="Scorer" players={scorerPlayers} name={goal.scorerName} shirt={goal.scorerShirtNumber} onChange={(name, shirt) => update({ scorerName: name, scorerShirtNumber: shirt })} />
      {!goal.isOwnGoal ? <Person title="Assist" players={scorerPlayers} name={goal.assistName} shirt={goal.assistShirtNumber} onChange={(name, shirt) => update({ assistName: name, assistShirtNumber: shirt })} /> : null}
      <div className="gs-grid"><label>Minute<input type="number" min="0" max="999" required value={goal.minute ?? 0} onChange={(event) => update({ minute: Number(event.target.value) })} /></label><label>Added minutes<input type="number" min="0" max="30" value={goal.stoppageMinute || 0} onChange={(event) => update({ stoppageMinute: Number(event.target.value) || null })} /></label></div>
      {!goal.isOwnGoal ? <label className="gs-check"><input type="checkbox" checked={goal.isPenaltyGoal || false} onChange={(event) => update({ isPenaltyGoal: event.target.checked })} />Penalty</label> : null}
      <label>Notes, optional<textarea maxLength={500} value={goal.notes || ''} onChange={(event) => update({ notes: event.target.value })} /></label>
      {goal.eventId ? <label>Reason for correction, optional<textarea maxLength={240} value={goal.reason || ''} onChange={(event) => update({ reason: event.target.value })} /></label> : null}
      <button className="gs-primary" disabled={busy} type="submit">{goal.eventId ? 'Save correction' : 'Save goal'}</button>
      {goal.eventId ? <button className="gs-danger" disabled={busy} type="button" onClick={() => onRemove(goal)}>Remove goal</button> : null}
    </form>
  </section></div>
}
const eventLabels = { goal: 'Goal', yellow_card: 'Yellow card', red_card: 'Red card', substitution: 'Substitution', water_break: 'Hydration break' }
function EventEditor({ draft, setDraft, players, onSave, onClose, busy }) {
  const [error, setError] = useState('')
  const update = (change) => setDraft((prior) => ({ ...prior, ...change }))
  const choices = draft.teamSide === 'club' ? players : []
  return <div className="gs-backdrop"><section className="gs-sheet" role="dialog" aria-modal="true" aria-label={eventLabels[draft.eventType]}>
    <header><h2>{eventLabels[draft.eventType]}</h2><button disabled={busy} onClick={onClose}>Close</button></header>
    <p>The match time was captured when you pressed the action.</p>
    <form onSubmit={(event) => { event.preventDefault(); try { onSave(validateScorerMatchEvent(draft)) } catch (failure) { setError(failure.message) } }}>
      <fieldset disabled={busy}>
        <label>Team<select value={draft.teamSide} onChange={(event) => update({ teamSide: event.target.value, playerName: '', playerShirtNumber: '', playerOnName: '', playerOnShirtNumber: '' })}><option value="club">Our team</option><option value="opponent">Opponent</option></select></label>
        <Person selectedOnly={draft.teamSide === 'club'} title={draft.eventType === 'substitution' ? 'Player off' : 'Player'} players={choices} name={draft.playerName} shirt={draft.playerShirtNumber} onChange={(name, shirt) => update({ playerName: name, playerShirtNumber: shirt })} />
        {draft.eventType === 'substitution' ? <Person selectedOnly={draft.teamSide === 'club'} title="Player on" players={choices.filter((player) => player.name !== draft.playerName || String(player.shirtNumber || '') !== String(draft.playerShirtNumber || ''))} name={draft.playerOnName} shirt={draft.playerOnShirtNumber} onChange={(name, shirt) => update({ playerOnName: name, playerOnShirtNumber: shirt })} /> : null}
        <div className="gs-grid"><label>Minute<input type="number" min="0" max="999" required value={draft.minute ?? 0} onChange={(event) => update({ minute: Number(event.target.value) })} /></label><label>Added minutes<input type="number" min="0" max="30" value={draft.stoppageMinute || 0} onChange={(event) => update({ stoppageMinute: Number(event.target.value) || null })} /></label></div>
        <label>Notes, optional<textarea maxLength={500} value={draft.notes || ''} onChange={(event) => update({ notes: event.target.value })} /></label>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}<button className="gs-primary" disabled={busy} type="submit">Save {eventLabels[draft.eventType].toLowerCase()}</button>
    </form>
  </section></div>
}
export function GuestScorerPage() {
  usePublicThemeScope()
  const location = useLocation()
  const [session, setSession] = useState(readSession)
  const [data, setData] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [goal, setGoal] = useState(null)
  const [eventDraft, setEventDraft] = useState(null)
  const [score, setScore] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [pending, setPending] = useState(session?.command || null)
  const active = useRef(false)
  const mounted = useRef(true)
  const saveSession = (next) => { localStorage.setItem(storageKey, JSON.stringify(next)); setSession(next) }
  useEffect(() => {
    if (!location.hash.startsWith('#invite=')) return
    const next = readSession()
    setSession(next); setData(null); setError(''); setPending(next?.command || null)
  }, [location.hash])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!session?.claimed) return
    let current = true
    const read = async () => {
      if (active.current) return
      try {
        const result = await requestGuestScorer({ token: session.token, action: 'read' })
        if (current) setData(result)
      } catch (failure) { if (current) setError(failure.message) }
    }
    void read()
    const timer = setInterval(read, 4000)
    return () => { current = false; clearInterval(timer) }
  }, [session?.claimed, session?.token])
  async function claim(event) {
    event.preventDefault()
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      const result = await requestGuestScorer({ action: 'claim', token: session.invite, details: { name, sessionToken: session.token } })
      saveSession({ ...session, claimed: true }); setData(result)
    } catch (failure) { setError(failure.message) }
    finally { active.current = false; setBusy(false) }
  }
  async function send(command) {
    if (active.current) return
    active.current = true; setBusy(true); setError(''); setConfirm(null)
    const savedCommand = { ...command, requestId: command.requestId || crypto.randomUUID() }
    setPending(savedCommand); saveSession({ ...session, command: savedCommand })
    try {
      const result = await requestGuestScorer({ ...savedCommand, token: session.token })
      if (!mounted.current) return
      setData(result); setGoal(null); setScore(null); setEventDraft(null)
      if (result.notificationWarning) { setError(result.notificationWarning) }
      else { setPending(null); saveSession({ ...session, command: null }) }
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message)
        if (failure.rejected) { setPending(null); saveSession({ ...session, command: null }) }
      }
    }
    finally { active.current = false; setBusy(false) }
  }
  const match = data?.match
  const finished = data?.status === 'finished'
  const waiting = session?.claimed && !match && !finished
  const disabled = busy || Boolean(pending)
  const themeMode = document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light'
  return <main className="guest-scorer" style={getThemeColorVariableStyle(match?.themeAccent || 'green', themeMode)}>
    <header className="gs-header"><div className="gs-brand"><img src={match?.clubLogoUrl || footballPlayerLogo} alt={match?.clubName ? `${match.clubName} crest` : 'Football Player'} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = footballPlayerLogo }} /><div><p>{match?.clubName || 'Football Player'}</p><small>Football Player | Guest scorer</small></div></div><h1>{match ? getMatchDayDisplayName(match) : 'Guest scorer'}</h1></header>
    {error ? <div role="alert" className="gs-error"><p>{error}</p>{pending ? <button disabled={busy} onClick={() => send(pending)}>Retry saved request</button> : null}</div> : null}
    {pending && !error ? <div className="gs-notice"><p>A scoring change is waiting for confirmation.</p><button disabled={busy} onClick={() => send(pending)}>Check saved change</button></div> : null}
    {!session ? <p>Ask the coach to show the guest scorer QR code for this match, then scan it with your phone camera.</p> : null}
    {session && !session.claimed ? <form onSubmit={claim}><p>You can help score one match. The coach will confirm your name before you get access.</p><label>Your name<input required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label><button className="gs-primary" disabled={busy}>Ask coach for access</button></form> : null}
    {waiting ? <section aria-live="polite"><h2>Waiting for coach approval</h2><p>Ask the coach to approve your name on their screen. This page will open automatically.</p></section> : null}
    {finished ? <section aria-live="polite"><h2>Full time</h2><p>The match has ended. The coach will review the report and conclude the game.</p><p>Your scoring access has now ended. Thank you for helping.</p></section> : null}
    {match ? <>
      <p className="gs-caption">Scoring as {data.name}. Access is limited to this match.</p>
      <div className="gs-score"><strong>{match.homeScore} : {match.awayScore}</strong><span>{formatMatchAddedTimeClock(match, now)}</span><small>{match.currentMatchPhase.replaceAll('_', ' ')}</small></div>
      <p className="gs-clock-setting">{getMatchClockDescription(match)} {match.timerStatus === 'not_started' ? 'Ask the coach to change this before starting if it is incorrect.' : ''}</p>
      <div className="gs-grid">{getParentScorerTimerActions(match).filter((item) => item.action !== 'conclude').map((item) => <button key={item.action} disabled={disabled || item.action === 'start' && !match.isToday} onClick={() => setConfirm({ label: item.label + '?', ...getGuestTimerRequest(item.action) })}>{item.label}</button>)}</div>
      {!match.isToday && match.timerStatus === 'not_started' ? <p>The match can be started on {match.matchDate}.</p> : null}
      {match.timerStatus !== 'not_started' ? <>
        <div className="gs-grid"><button className="gs-primary" disabled={disabled} onClick={() => setGoal({ teamSide: 'club', scorerName: '', scorerShirtNumber: '', assistName: '', assistShirtNumber: '', notes: '', ...captureMatchEventTime(match) })}>Add goal</button><button disabled={disabled} onClick={() => setScore({ homeScore: match.homeScore, awayScore: match.awayScore, reason: '' })}>Correct score</button></div>
        <div className="gs-grid">{['yellow_card', 'red_card', 'substitution'].map((eventType) => <button key={eventType} disabled={disabled} onClick={() => setEventDraft({ eventType, teamSide: 'club', playerName: '', playerShirtNumber: '', playerOnName: '', playerOnShirtNumber: '', notes: '', ...captureMatchEventTime(match) })}>{eventLabels[eventType]}</button>)}</div>
        {match.currentMatchPhase === 'penalties' ? <section><h2>Shootout: {match.homeShootoutScore} : {match.awayShootoutScore}</h2><div className="gs-grid">{['club', 'opponent'].flatMap((teamSide) => ['scored', 'missed'].map((outcome) => <button key={teamSide + outcome} disabled={disabled} onClick={() => setConfirm({ label: (teamSide === 'club' ? 'Our team' : 'Opponent') + ' ' + outcome + '?', action: 'shootout', details: { teamSide, outcome } })}>{teamSide === 'club' ? 'Our team' : 'Opponent'} {outcome}</button>))}</div></section> : null}
        <h2>Match events</h2>{match.events.length ? match.events.map((event) => {
          const isGoal = !event.eventType || event.eventType === 'goal'
          return <button className="gs-event" key={event.id} disabled={disabled} onClick={() => isGoal ? setGoal({ ...event, eventId: event.id }) : setConfirm({ label: `Remove this ${eventLabels[event.eventType]?.toLowerCase() || 'event'}?`, action: 'remove_event', details: { eventId: event.id } })}><strong>{event.minute ?? 0}{event.stoppageMinute ? '+' + event.stoppageMinute : ''}' {eventLabels[event.eventType || 'goal']}: {event.scorerName || (event.teamSide === 'club' ? 'Our team' : 'Opponent')}{event.isOwnGoal ? ' (own goal)' : ''}</strong><span>{isGoal ? `Goal for ${event.teamSide === 'club' ? match.teamName : match.opponent}. ` : ''}{event.assistName ? (event.eventType === 'substitution' ? 'Player on: ' : 'Assist: ') + event.assistName + '. ' : ''}{isGoal ? 'Tap to correct or remove' : 'Tap to remove'}</span></button>
        }) : <p>No match events recorded yet.</p>}
      </> : null}
      {goal ? <GoalEditor goal={goal} setGoal={setGoal} players={match.players} busy={busy || Boolean(pending)} onClose={() => setGoal(null)} onSave={(details) => send({ action: details.eventId ? 'correct_goal' : 'goal', details })} onRemove={(details) => { setGoal(null); setConfirm({ label: 'Remove this goal?', action: 'remove_goal', details: { eventId: details.eventId, reason: details.reason || '' } }) }} /> : null}
      {eventDraft ? <EventEditor draft={eventDraft} setDraft={setEventDraft} players={match.players} busy={disabled} onClose={() => setEventDraft(null)} onSave={(details) => send({ action: 'event', details })} /> : null}
      {score ? <div className="gs-backdrop"><section className="gs-sheet" role="dialog" aria-modal="true" aria-label="Correct score"><header><h2>Correct score</h2><button disabled={busy} onClick={() => setScore(null)}>Close</button></header><form onSubmit={(event) => { event.preventDefault(); void send({ action: 'score', details: score }) }}><div className="gs-grid">{['homeScore', 'awayScore'].map((key) => <label key={key}>{key === 'homeScore' ? 'Home score' : 'Away score'}<input type="number" min="0" max="99" required value={score[key]} onChange={(event) => setScore({ ...score, [key]: Number(event.target.value) })} /></label>)}</div><label>Reason, optional<textarea maxLength={240} value={score.reason} onChange={(event) => setScore({ ...score, reason: event.target.value })} /></label><button className="gs-primary" disabled={disabled}>Save score correction</button></form></section></div> : null}
    </> : null}
    {confirm ? <div className="gs-backdrop"><section className="gs-sheet" role="dialog" aria-modal="true" aria-label="Confirm scoring change"><h2>{confirm.label}</h2>{confirm.action === 'start' || confirm.details?.action === 'half_time' || confirm.details?.action === 'resume' ? <p>{getMatchClockDescription(match)}</p> : null}{confirm.details?.action === 'full_time' ? <p>This ends your scoring access and asks the coaches to review and conclude the game.</p> : null}<button className="gs-primary" disabled={disabled} onClick={() => send({ action: confirm.action, details: confirm.details })}>Confirm</button><button onClick={() => setConfirm(null)}>Cancel</button></section></div> : null}
  </main>
}
