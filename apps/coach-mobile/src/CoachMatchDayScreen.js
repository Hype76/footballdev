import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activateKeepAwakeAsync, deactivateKeepAwake, isAvailableAsync } from 'expo-keep-awake'
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { buildCompletedMatchEventPresentation } from '../../../src/lib/matchday-final-report.js'
import {
  buildCoachFinalMatchReport,
  buildCoachMatchDaySquad,
  createCoachMatchDayEventForm,
  filterCoachMatchDays,
  getCoachMatchDayActions,
  getCoachMatchDayPresentation,
  getCoachMatchDayUndoModel,
  hasCoachMatchDayCommandResult,
  isCoachMatchDayEventVoided,
  isCoachMatchDayFinalReportApplied,
  isCoachMatchDayGoalCorrectionApplied,
  isCoachMatchDayShootoutKickApplied,
  isCoachMatchDayShootoutKickVoided,
  isCoachMatchDaySquadDecisionApplied,
  isCoachMatchDayTimerActionApplied,
  isCoachMatchDayVolunteerSelectionApplied,
  validateCoachMatchDayEventForm,
} from '../../mobile-core/src/coachMatchDayCore'
import {
  correctCoachMatchDayGoal,
  correctCoachMatchDayScore,
  createCoachMatchDayCommandId,
  getCoachMatchDayDetail,
  getCoachMatchDayList,
  normalizeCoachMatchDay,
  recordCoachMatchDayEvent,
  recordCoachMatchDayShootoutKick,
  runCoachMatchDayTimerAction,
  saveCoachMatchDayFinalReport,
  selectCoachMatchDayVolunteer,
  setCoachMatchDaySquadDecision,
  voidCoachMatchDayEvent,
  voidCoachMatchDayShootoutKick,
} from '../../mobile-core/src/coachMatchDayData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { useConfirmedConnectionIssue, useConfirmedConnectionMessage } from '../../mobile-core/src/useConfirmedConnectionIssue'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'
import { CoachFormationBoard } from './CoachFormationBoard'
import { CoachFixtureForm } from './CoachFixtureForm'
import { getCoachFriendlyError } from './coachFriendlyErrors'

const config = getMobileRuntimeConfig('coach')
const MATCH_DAY_PANEL_OPTIONS = [
  { label: 'Overview', value: 'overview' },
  { label: 'Squad', value: 'squad' },
  { label: 'Formation', value: 'formation' },
  { label: 'Volunteers', value: 'volunteers' },
  { label: 'Live', value: 'live' },
  { label: 'Timeline', value: 'timeline' },
  { label: 'Shootout', value: 'shootout' },
  { label: 'Report', value: 'report' },
]

function normalize(value) { return String(value ?? '').trim() }
const errorMessage = getCoachFriendlyError
function label(value, fallback = '') { return normalize(value).replace(/_/g, ' ') || fallback }
function normalizeCachedMatches(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === 'object')
    .map(normalizeCoachMatchDay)
}

function createStyles(palette) {
  return StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 13, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
    actionDanger: { backgroundColor: palette.danger },
    actionDisabled: { opacity: 0.45 },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900', textAlign: 'center' },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 20 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 17, borderWidth: 1, gap: 9, padding: 15 },
    cardSelected: { borderColor: palette.accent, borderWidth: 2 },
    cardTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    fixtureHero: { backgroundColor: palette.selected, borderColor: palette.accent, borderRadius: 17, borderWidth: 1, gap: 11, padding: 15 },
    fixtureHeroLive: { borderWidth: 2 },
    fixtureTitle: { color: palette.textPrimary, fontSize: 22, fontWeight: '900', lineHeight: 28 },
    gameMode: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 17, borderWidth: 1, gap: 12, padding: 15 },
    gameModeEyebrow: { color: palette.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, textTransform: 'uppercase' },
    gameStat: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, flex: 1, gap: 4, minWidth: 88, padding: 11 },
    gameStatLabel: { color: palette.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
    gameStatValue: { color: palette.textPrimary, fontSize: 18, fontVariant: ['tabular-nums'], fontWeight: '900' },
    gameStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    liveSync: { alignSelf: 'flex-start', backgroundColor: palette.surface, borderColor: palette.accent, borderRadius: 9, borderWidth: 1, color: palette.accent, fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 7 },
    quickAction: { flexBasis: '47%', flexGrow: 1 },
    quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    sectionHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
    timelineItem: { borderTopColor: palette.border, borderTopWidth: 1, gap: 3, paddingTop: 10 },
    timelineMinute: { color: palette.accent, fontSize: 13, fontWeight: '900' },
    chip: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 13 },
    chipActive: { backgroundColor: palette.selected, borderColor: palette.accent },
    chipText: { color: palette.textSecondary, fontSize: 12, fontWeight: '900' },
    chipTextActive: { color: palette.selectedForeground },
    clock: { color: palette.accent, fontSize: 42, fontVariant: ['tabular-nums'], fontWeight: '900', textAlign: 'center' },
    dangerText: { color: palette.danger, fontSize: 13, fontWeight: '800', lineHeight: 19 },
    field: { gap: 5 },
    fieldLabel: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    input: { backgroundColor: palette.background, borderColor: palette.border, borderRadius: 12, borderWidth: 1, color: palette.textPrimary, fontSize: 15, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
    inputText: { color: palette.textPrimary, fontSize: 15 },
    inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
    meta: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18 },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.72)' },
    modalCard: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 18, borderWidth: 1, gap: 10, marginHorizontal: 20, padding: 18 },
    modalScreen: { flex: 1, justifyContent: 'center' },
    pickerActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
    pickerButton: { alignItems: 'center', borderColor: palette.border, borderRadius: 10, borderWidth: 1, minHeight: 42, justifyContent: 'center', minWidth: 88, paddingHorizontal: 12 },
    pickerButtonText: { color: palette.accent, fontSize: 14, fontWeight: '900' },
    pickerPanel: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, gap: 8, overflow: 'hidden', padding: 8 },
    row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
    score: { color: palette.textPrimary, fontSize: 38, fontWeight: '900', textAlign: 'center' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 13, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13, paddingVertical: 9 },
    secondaryDanger: { backgroundColor: palette.surfaceRaised, borderColor: palette.danger },
    secondaryDangerText: { color: palette.danger },
    secondaryWarning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning },
    secondaryWarningText: { color: palette.warning },
    secondaryText: { color: palette.textPrimary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
    stack: { gap: 12 },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    title: { color: palette.textPrimary, fontSize: 29, fontWeight: '900' },
    warning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 14, borderWidth: 1, gap: 6, padding: 12 },
  })
}

function Button({ danger = false, disabled = false, label, onPress, secondary = false, styles, warning = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [secondary ? styles.secondary : styles.action, danger && (secondary ? styles.secondaryDanger : styles.actionDanger), warning && secondary && styles.secondaryWarning, disabled && styles.actionDisabled, pressed && { opacity: 0.74 }]}><Text style={[secondary ? styles.secondaryText : styles.actionText, danger && secondary && styles.secondaryDangerText, warning && secondary && styles.secondaryWarningText]}>{label}</Text></Pressable>
}

function Chips({ onChange, options, styles, value }) {
  return <View style={styles.tabs}>{options.map((option) => { const selected = value === option.value; return <Pressable accessibilityRole="button" accessibilityState={{ selected }} key={option.value} onPress={() => onChange(option.value)} style={[styles.chip, selected && styles.chipActive]}><Text style={[styles.chipText, selected && styles.chipTextActive]}>{option.label}</Text></Pressable> })}</View>
}

function Field({ label, multiline = false, onChangeText, styles, value }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} multiline={multiline} onChangeText={onChangeText} style={[styles.input, multiline && styles.inputMultiline]} value={String(value ?? '')} /></View>
}

function MatchList({ filter, matches, onOpen, selectedId, setFilter, styles }) {
  const visible = filterCoachMatchDays(matches, filter)
  return <View style={styles.stack}>
    <Chips onChange={setFilter} options={[{ label: 'Today and live', value: 'current' }, { label: 'Upcoming', value: 'upcoming' }, { label: 'Previous', value: 'previous' }, { label: 'All', value: 'all' }]} styles={styles} value={filter} />
    {visible.length === 0 ? <Text style={styles.body}>No fixtures match this view.</Text> : null}
    {visible.map((match) => { const view = getCoachMatchDayPresentation(match); return <Pressable accessibilityRole="button" key={match.id} onPress={() => onOpen(match)} style={[styles.card, selectedId === match.id && styles.cardSelected]}><Text style={styles.cardTitle}>{view.displayName}</Text><Text style={styles.meta}>{match.matchDate || 'Date TBC'} | {match.kickoffTimeTbc ? 'Kick-off TBC' : match.kickoffTime || 'Time TBC'} | {label(match.status, 'scheduled')}</Text><Text style={styles.body}>{view.displayScore} | {view.phaseLabel}</Text></Pressable> })}
  </View>
}

function isLiveMatch(match) {
  return ['extra_time', 'half_time', 'live', 'penalties', 'second_half'].includes(normalize(match?.status))
}

function formatFixtureDate(value) {
  const normalized = normalize(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized || 'Date TBC'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
    weekday: 'short',
  }).format(new Date(`${normalized}T12:00:00Z`))
}

function FixtureHero({ match, now, styles }) {
  const [currentNow, setCurrentNow] = useState(() => Date.now())
  useEffect(() => {
    if (Number.isFinite(now) || !isLiveMatch(match)) return undefined
    const clockId = setInterval(() => setCurrentNow(Date.now()), 1000)
    return () => clearInterval(clockId)
  }, [match, now])
  const view = getCoachMatchDayPresentation(match, Number.isFinite(now) ? now : currentNow)
  const live = isLiveMatch(match)
  return <View style={[styles.fixtureHero, live && styles.fixtureHeroLive]}>
    <View style={styles.tabs}>
      <Text style={styles.liveSync}>{live ? 'Live sync on' : label(match.status, 'Scheduled')}</Text>
      <Text style={styles.liveSync}>{view.phaseLabel}</Text>
      {match.homeAway ? <Text style={styles.liveSync}>{label(match.homeAway)}</Text> : null}
      {match.fixtureType ? <Text style={styles.liveSync}>{label(match.fixtureType)}</Text> : null}
    </View>
    <Text accessibilityRole="header" style={styles.fixtureTitle}>{view.displayName}</Text>
    <Text style={styles.body}>{formatFixtureDate(match.matchDate)}, {match.kickoffTimeTbc ? 'Kick-off TBC' : match.kickoffTime || 'Time TBC'} at {match.venueName || 'Venue TBC'}</Text>
    <View style={styles.card}>
      <Text style={styles.gameStatLabel}>Score</Text>
      <Text accessibilityLiveRegion="polite" style={styles.score}>{view.displayScore}</Text>
      <View style={styles.gameStats}>
        <View style={styles.gameStat}><Text style={styles.gameStatLabel}>Match timer</Text><Text accessibilityLiveRegion="polite" style={styles.gameStatValue}>{view.clock}</Text></View>
        <View style={styles.gameStat}><Text style={styles.gameStatLabel}>Period</Text><Text style={styles.gameStatValue}>{view.phaseLabel}</Text></View>
      </View>
    </View>
  </View>
}

function SquadPanel({ actions, busy, match, onSetDecision, players, styles }) {
  const squad = buildCoachMatchDaySquad(players, match)
  return <View style={styles.stack}>
    <View style={styles.card}><Text style={styles.cardTitle}>Squad summary</Text><Text style={styles.body}>Selected {squad.summary.selected} | Waiting {squad.summary.waiting} | Not selected {squad.summary.notSelected} | Undecided {squad.summary.undecided}</Text><Text style={styles.meta}>Availability and squad decisions are separate authoritative states. Optimistic concurrency protects each decision.</Text></View>
    {!actions.canSetSquad ? <View style={styles.warning}><Text style={styles.body}>{actions.blockedReason || 'Squad decisions are locked after the fixture starts.'}</Text></View> : null}
    {squad.rows.map((player) => <View key={player.id} style={styles.card}><Text style={styles.cardTitle}>{player.playerName}</Text><Text style={styles.meta}>{player.availabilityLabel} | {player.decisionLabel}{player.shirtNumber ? ` | #${player.shirtNumber}` : ''}</Text><View style={styles.tabs}>{['selected', 'waiting', 'not_selected', 'undecided'].map((decision) => <Button disabled={busy || !actions.canSetSquad || decision === player.decision} key={decision} label={decision.replace('_', ' ')} onPress={() => onSetDecision(player, decision)} secondary styles={styles} />)}</View></View>)}
  </View>
}

function VolunteerPanel({ actions, busy, match, onSelect, styles }) {
  const assignmentByRole = new Map((match.roleAssignments || []).map((item) => [item.role, item]))
  return <View style={styles.stack}>
    <View style={styles.warning}><Text style={styles.cardTitle}>{config.isProduction ? 'Canonical recipient action' : 'Communications disabled'}</Text><Text style={styles.body}>{config.isProduction ? 'Volunteer assignment is online-only. A confirmed change uses canonical production authority and may queue the approved recipient notification.' : 'This test app does not send scorer requests, availability reminders, email, or push notifications. It can only select from existing server-authoritative responses.'}</Text></View>
    {match.volunteerEligibilityError ? <Text style={styles.dangerText}>{match.volunteerEligibilityError}</Text> : null}
    {['scorer', 'linesman', 'referee'].map((role) => { const assignment = assignmentByRole.get(role); const assignmentRequest = (match.availabilityRequests || []).find((request) => request.parentLinkId === assignment?.parentLinkId); const removalTarget = assignment ? { ...(assignmentRequest || {}), parentLinkId: assignment.parentLinkId, requestId: assignmentRequest?.requestId || '' } : null; return <View key={role} style={styles.card}><Text style={styles.cardTitle}>{role.charAt(0).toUpperCase() + role.slice(1)}</Text><Text style={styles.body}>{assignment?.playerName || (assignment ? 'Assigned Parent' : 'Not assigned')}</Text>{removalTarget ? <Button disabled={busy || !actions.canSelectVolunteers} label="Remove assignment" onPress={() => onSelect(removalTarget, role, false)} secondary styles={styles} /> : null}{(match.availabilityRequests || []).filter((request) => role !== 'scorer' || request.scorerEligible).filter((request) => request[`volunteer${role.charAt(0).toUpperCase() + role.slice(1)}Response`] === 'yes').map((request) => <Button disabled={busy || !actions.canSelectVolunteers} key={`${role}-${request.id}`} label={`${assignment ? 'Change to' : 'Select'} ${request.recipientName || request.playerName || 'eligible Parent'}`} onPress={() => onSelect(request, role, true)} secondary styles={styles} />)}</View> })}
  </View>
}

function LiveTimeline({ match, styles }) {
  const visibleEvents = (match.events || []).slice(-50).reverse()
  return <View style={styles.card}>
    <View style={styles.sectionHeader}><Text style={styles.cardTitle}>Match Timeline</Text><Text style={styles.liveSync}>Coach view</Text></View>
    {visibleEvents.length === 0 ? <Text style={styles.body}>No match events yet. Goals, cards and match actions will appear here once recorded.</Text> : null}
    {visibleEvents.map((event) => <View key={event.id} style={styles.timelineItem}>
      <Text style={styles.timelineMinute}>{event.minute == null ? 'Match event' : `${event.minute}'`}</Text>
      <Text style={styles.cardTitle}>{label(event.eventType, 'Match event')}</Text>
      <Text style={styles.body}>{event.scorerName || event.playerName || event.notes || label(event.teamSide)}</Text>
      <Text style={styles.meta}>{event.homeScore} - {event.awayScore} | {label(event.eventStatus)}</Text>
    </View>)}
  </View>
}

function LivePanel({ actions, busy, eventForm, match, onEventForm, onExit, onPrepare, onScore, onTimer, scoreDraft, setScoreDraft, styles }) {
  const [now, setNow] = useState(() => Date.now())
  const [eventComposerOpen, setEventComposerOpen] = useState(false)
  const [keepAwake, setKeepAwake] = useState(false)
  const [keepAwakeAvailable, setKeepAwakeAvailable] = useState(true)
  const [scoreCorrectionOpen, setScoreCorrectionOpen] = useState(false)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => {
    let mounted = true
    void isAvailableAsync().then((available) => mounted && setKeepAwakeAvailable(available)).catch(() => mounted && setKeepAwakeAvailable(false))
    return () => {
      mounted = false
      void deactivateKeepAwake('football-player-coach-game-day').catch(() => {})
    }
  }, [])
  const view = getCoachMatchDayPresentation(match, now)
  const prepareEvent = (eventType) => {
    onEventForm(createCoachMatchDayEventForm(eventType, match))
    setEventComposerOpen(true)
  }
  const timerAction = (action) => actions.timerActions.find((item) => item.action === action)
  const runTimer = (action, fallbackLabel) => {
    const item = timerAction(action)
    if (!item) return
    onPrepare({ kind: 'timer', label: item.label || fallbackLabel, run: () => onTimer(action) })
  }
  const toggleKeepAwake = async (enabled) => {
    try {
      if (enabled) await activateKeepAwakeAsync('football-player-coach-game-day')
      else await deactivateKeepAwake('football-player-coach-game-day')
      setKeepAwake(enabled)
    } catch {
      setKeepAwake(false)
      setKeepAwakeAvailable(false)
    }
  }
  return <View style={styles.stack}>
    <FixtureHero match={match} now={now} styles={styles} />
    {actions.blockedReason ? <View style={styles.warning}><Text style={styles.body}>{actions.blockedReason}</Text></View> : null}
    <View style={styles.gameMode}>
      <Text style={styles.gameModeEyebrow}>Game mode</Text>
      <Text style={styles.cardTitle}>Live controller</Text>
      <Button label="Manage fixture" onPress={onExit} secondary styles={styles} />
      <Button label="Exit Game Mode" onPress={onExit} secondary styles={styles} />
      <View style={styles.gameStats}>
        <View style={styles.gameStat}><Text style={styles.gameStatLabel}>Score</Text><Text style={styles.gameStatValue}>{view.displayScore}</Text></View>
        <View style={styles.gameStat}><Text style={styles.gameStatLabel}>Match timer</Text><Text style={styles.gameStatValue}>{view.clock}</Text></View>
        <View style={styles.gameStat}><Text style={styles.gameStatLabel}>Period</Text><Text style={styles.gameStatValue}>{view.phaseLabel}</Text></View>
      </View>
      <View style={styles.card}>
        <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Keep screen awake</Text><Text style={styles.meta}>{keepAwakeAvailable ? 'Optional for this Game Day session. No match data is changed.' : 'Unavailable on this device.'}</Text></View><Switch accessibilityLabel="Keep screen awake" disabled={!keepAwakeAvailable} onValueChange={toggleKeepAwake} value={keepAwake} /></View>
      </View>
      <View style={styles.quickActions}>
        <View style={styles.quickAction}><Button disabled={busy || !actions.canRecordEvents} label="Goal" onPress={() => prepareEvent('goal')} styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !actions.canRecordEvents} label="Yellow" onPress={() => prepareEvent('yellow_card')} secondary styles={styles} warning /></View>
        <View style={styles.quickAction}><Button danger disabled={busy || !actions.canRecordEvents} label="Red" onPress={() => prepareEvent('red_card')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !actions.canRecordEvents} label="Sub" onPress={() => prepareEvent('substitution')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !timerAction('pause')} label="Pause" onPress={() => runTimer('pause', 'Pause')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !timerAction('hydration')} label="Hydration" onPress={() => runTimer('hydration', 'Hydration')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !timerAction('half_time')} label="HT" onPress={() => runTimer('half_time', 'Half time')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !timerAction('full_time')} label="FT" onPress={() => runTimer('full_time', 'Full time')} danger styles={styles} /></View>
        {timerAction('start') ? <View style={styles.quickAction}><Button disabled={busy} label="Start match" onPress={() => runTimer('start', 'Start match')} styles={styles} /></View> : null}
        {timerAction('resume') ? <View style={styles.quickAction}><Button disabled={busy} label="Resume" onPress={() => runTimer('resume', 'Resume')} secondary styles={styles} /></View> : null}
      </View>
      <Button label={scoreCorrectionOpen ? 'Hide score correction' : 'Correct score'} onPress={() => setScoreCorrectionOpen((current) => !current)} secondary styles={styles} />
      {scoreCorrectionOpen ? <View style={styles.card}><Text style={styles.cardTitle}>Correct score</Text><View style={styles.row}><Field label="Home" onChangeText={(value) => setScoreDraft({ ...scoreDraft, home: value })} styles={styles} value={scoreDraft.home} /><Field label="Away" onChangeText={(value) => setScoreDraft({ ...scoreDraft, away: value })} styles={styles} value={scoreDraft.away} /></View><Button disabled={busy || !actions.canRecordEvents} label="Review score correction" onPress={() => onPrepare({ kind: 'score', label: 'Save score correction', run: onScore })} secondary styles={styles} /></View> : null}
    </View>
    {eventComposerOpen ? <View style={styles.card}><View style={styles.sectionHeader}><Text style={styles.cardTitle}>Record event</Text><Button label="Close" onPress={() => setEventComposerOpen(false)} secondary styles={styles} /></View><Chips onChange={(value) => onEventForm(createCoachMatchDayEventForm(value, match))} options={[{ label: 'Goal', value: 'goal' }, { label: 'Yellow card', value: 'yellow_card' }, { label: 'Red card', value: 'red_card' }, { label: 'Substitution', value: 'substitution' }]} styles={styles} value={eventForm.eventType} /><Chips onChange={(value) => onEventForm({ ...eventForm, teamSide: value })} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={eventForm.teamSide} /><Field label="Minute" onChangeText={(value) => onEventForm({ ...eventForm, minute: value })} styles={styles} value={eventForm.minute} />{eventForm.eventType === 'goal' ? <><Field label="Scorer" onChangeText={(value) => onEventForm({ ...eventForm, scorerName: value })} styles={styles} value={eventForm.scorerName} /><Field label="Scorer shirt number" onChangeText={(value) => onEventForm({ ...eventForm, scorerShirtNumber: value })} styles={styles} value={eventForm.scorerShirtNumber} /><Field label="Assist" onChangeText={(value) => onEventForm({ ...eventForm, assistName: value })} styles={styles} value={eventForm.assistName} /><View style={styles.row}><Text style={styles.fieldLabel}>Penalty</Text><Switch accessibilityLabel="Penalty" onValueChange={(value) => onEventForm({ ...eventForm, isPenaltyGoal: value })} value={eventForm.isPenaltyGoal} /></View></> : <><Field label={eventForm.eventType === 'substitution' ? 'Player off' : 'Player'} onChangeText={(value) => onEventForm({ ...eventForm, playerName: value })} styles={styles} value={eventForm.playerName} />{eventForm.eventType === 'substitution' ? <Field label="Player on" onChangeText={(value) => onEventForm({ ...eventForm, playerOnName: value })} styles={styles} value={eventForm.playerOnName} /> : null}</>}<Field label="Notes" multiline onChangeText={(value) => onEventForm({ ...eventForm, notes: value })} styles={styles} value={eventForm.notes} /><Button disabled={busy || !actions.canRecordEvents} label="Review event" onPress={() => onPrepare({ kind: 'event', label: `Record ${eventForm.eventType.replaceAll('_', ' ')}`, run: () => onScore('event') })} styles={styles} /></View> : null}
    <LiveTimeline match={match} styles={styles} />
  </View>
}

function TimelinePanel({ busy, match, onCorrectGoal, onPrepare, onUndo, styles }) {
  const [undoEvent, setUndoEvent] = useState(null)
  const [correctEvent, setCorrectEvent] = useState(null)
  const [goalDraft, setGoalDraft] = useState(null)
  const [correctionReason, setCorrectionReason] = useState('')
  const [reasonCode, setReasonCode] = useState('')
  const [note, setNote] = useState('')
  const visibleEvents = (match.events || []).slice(-200)
  return <View style={styles.stack}>
    {(match.events || []).length === 0 ? <Text style={styles.body}>No Match Day events have been recorded.</Text> : null}
    {(match.events || []).length > visibleEvents.length ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Showing the latest {visibleEvents.length} timeline events.</Text> : null}
    {visibleEvents.map((event) => { const undo = getCoachMatchDayUndoModel(event); return <View key={event.id} style={styles.card}><Text style={styles.cardTitle}>{event.eventType.replaceAll('_', ' ')} {event.minute === null ? '' : `${event.minute}'`}</Text><Text style={styles.body}>{event.scorerName || event.playerName || event.notes || event.teamSide}</Text><Text style={styles.meta}>{event.homeScore} - {event.awayScore} | {event.eventStatus}</Text>{event.eventType === 'goal' && event.eventStatus !== 'voided' ? <Button disabled={busy} label="Correct goal details" onPress={() => { setCorrectEvent(event); setCorrectionReason(''); setGoalDraft({ assistName: event.assistName, assistShirtNumber: event.assistShirtNumber, minute: String(event.minute ?? ''), notes: event.notes, scorerName: event.scorerName, scorerShirtNumber: event.scorerShirtNumber, teamSide: event.teamSide }) }} secondary styles={styles} /> : null}{undo.canUndo ? <Button disabled={busy} label="Undo event" onPress={() => { setUndoEvent(event); setReasonCode(''); setNote('') }} secondary styles={styles} /> : null}</View> })}
    {correctEvent && goalDraft ? <View style={styles.warning}><Text style={styles.cardTitle}>Correct goal details</Text><Chips onChange={(value) => setGoalDraft({ ...goalDraft, teamSide: value })} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={goalDraft.teamSide} /><Field label="Minute" onChangeText={(value) => setGoalDraft({ ...goalDraft, minute: value })} styles={styles} value={goalDraft.minute} /><Field label="Scorer" onChangeText={(value) => setGoalDraft({ ...goalDraft, scorerName: value })} styles={styles} value={goalDraft.scorerName} /><Field label="Scorer shirt number" onChangeText={(value) => setGoalDraft({ ...goalDraft, scorerShirtNumber: value })} styles={styles} value={goalDraft.scorerShirtNumber} /><Field label="Assist" onChangeText={(value) => setGoalDraft({ ...goalDraft, assistName: value })} styles={styles} value={goalDraft.assistName} /><Field label="Correction reason" onChangeText={setCorrectionReason} styles={styles} value={correctionReason} /><Button disabled={busy || !correctionReason} label="Review goal correction" onPress={() => onPrepare({ kind: 'correct-goal', label: 'Correct goal and retain audit history', run: async () => { const validated = validateCoachMatchDayEventForm({ ...goalDraft, eventType: 'goal' }); await onCorrectGoal(correctEvent, validated, correctionReason); setCorrectEvent(null); setGoalDraft(null) } })} styles={styles} /><Button label="Cancel" onPress={() => { setCorrectEvent(null); setGoalDraft(null) }} secondary styles={styles} /></View> : null}
    {undoEvent ? <View style={styles.warning}><Text style={styles.cardTitle}>Confirm timeline correction</Text><Chips onChange={setReasonCode} options={getCoachMatchDayUndoModel(undoEvent).options} styles={styles} value={reasonCode} /><Field label="Correction note" multiline onChangeText={setNote} styles={styles} value={note} /><Button disabled={busy || !reasonCode} danger label="Review undo" onPress={() => onPrepare({ kind: 'undo', label: 'Void timeline event', run: async () => { await onUndo(undoEvent, { note, reasonCode }); setUndoEvent(null) } })} styles={styles} /><Button label="Cancel" onPress={() => setUndoEvent(null)} secondary styles={styles} /></View> : null}
  </View>
}

function ShootoutPanel({ busy, match, onKick, onPrepare, onVoid, styles }) {
  const [kick, setKick] = useState({ notes: '', outcome: 'scored', playerName: '', teamSide: 'club' })
  return <View style={styles.stack}><View style={styles.card}><Text style={styles.cardTitle}>Penalty shootout</Text><Text style={styles.score}>{match.homeShootoutScore} - {match.awayShootoutScore}</Text><Chips onChange={(value) => setKick({ ...kick, teamSide: value })} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={kick.teamSide} /><Chips onChange={(value) => setKick({ ...kick, outcome: value })} options={[{ label: 'Scored', value: 'scored' }, { label: 'Missed', value: 'missed' }]} styles={styles} value={kick.outcome} /><Field label="Player" onChangeText={(value) => setKick({ ...kick, playerName: value })} styles={styles} value={kick.playerName} /><Field label="Notes" onChangeText={(value) => setKick({ ...kick, notes: value })} styles={styles} value={kick.notes} /><Button disabled={busy || match.currentMatchPhase !== 'penalties'} label="Review penalty" onPress={() => onPrepare({ kind: 'kick', label: 'Record penalty', run: () => onKick(kick) })} styles={styles} /></View>{(match.shootoutEvents || []).map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.kickNumber}. {item.teamSide} {item.outcome}</Text><Text style={styles.body}>{item.playerName || 'Player not recorded'}</Text>{item.eventStatus !== 'voided' ? <Button disabled={busy} label="Void penalty" onPress={() => onPrepare({ kind: 'void-kick', label: 'Void penalty kick', run: () => onVoid(item.id) })} secondary styles={styles} /> : null}</View>)}</View>
}

function ReportPanel({ busy, canSave, match, onSave, styles }) {
  const report = buildCoachFinalMatchReport(match)
  const activeEvents = report.activeEvents.slice().reverse()
  const [notes, setNotes] = useState(match.finalReport?.staffNotes || '')
  return <View style={styles.stack}>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Final result</Text>
      <Text selectable style={styles.score}>{report.result.finalScore}</Text>
      {report.result.shootoutScore ? <Text style={styles.body}>Shootout {report.result.shootoutScore}{report.result.shootoutWinner ? ` | ${report.result.shootoutWinner} won` : ''}</Text> : null}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Match summary</Text>
      <Text style={styles.body}>Goals {report.activeGoals.length} | Cards {report.activeCards.length} | Substitutions {report.activeSubstitutions.length}</Text>
      <Text style={styles.meta}>Active events {report.activeEvents.length} | Corrected or voided events {report.voidedEvents.length}</Text>
      {activeEvents.length === 0 ? <Text style={styles.body}>No match events were recorded.</Text> : null}
      {activeEvents.map((event) => {
        const presentation = buildCompletedMatchEventPresentation(event, match)
        return <View key={event.id} style={styles.field}><View style={styles.row}><Text style={styles.fieldLabel}>{presentation.minuteLabel} | {presentation.title}</Text><Text style={styles.meta}>{presentation.scoreLabel}</Text></View><Text style={styles.body}>{presentation.team.name}{presentation.detail ? ` | ${presentation.detail}` : ''}</Text>{presentation.notes ? <Text style={styles.meta}>{presentation.notes}</Text> : null}</View>
      })}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Final Match Report</Text>
      {match.status !== 'full_time' ? <Text style={styles.body}>Finish the match before saving the final report.</Text> : null}
      {!canSave && match.status === 'full_time' ? <Text style={styles.body}>Reconnect and confirm Coach access before saving this report.</Text> : null}
      <Field label="Coach notes" multiline onChangeText={setNotes} styles={styles} value={notes} />
      <Button disabled={busy || !canSave} label="Save final report" onPress={() => onSave(notes)} styles={styles} />
    </View>
  </View>
}

export function CoachMatchDayScreen({ context, matchDayTarget, onMatchDayTargetHandled, onNavigate, onQuickActionHandled, onRequestScrollTop, palette, quickAction, user }) {
  const styles = useMemo(() => createStyles(palette), [palette])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [eventForm, setEventForm] = useState(createCoachMatchDayEventForm())
  const [filter, setFilter] = useState(matchDayTarget?.fixtureId ? 'all' : 'current')
  const [fixtureFormOpen, setFixtureFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState(null)
  const [matches, setMatches] = useState([])
  const [notice, setNotice] = useState('')
  const [panel, setPanel] = useState('overview')
  const [pending, setPending] = useState(null)
  const [players, setPlayers] = useState([])
  const [scoreDraft, setScoreDraft] = useState({ away: '0', home: '0' })
  const [stale, setStale] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const confirmedStale = useConfirmedConnectionIssue(stale)
  const visibleError = useConfirmedConnectionMessage(error)
  const appState = useRef(AppState.currentState)
  const backgroundedAt = useRef(0)
  const busyRef = useRef(false)
  const contextRef = useRef(context)
  const loadInFlight = useRef(false)
  const matchRef = useRef(null)
  const selectedMatchId = useRef('')
  const targetRequestId = useRef('')
  const userRef = useRef(user)

  const requestedFixtureId = String(matchDayTarget?.fixtureId || '').trim()
  const selectedMatchIsLive = isLiveMatch(match)
  if (requestedFixtureId && targetRequestId.current !== matchDayTarget?.requestId) {
    targetRequestId.current = matchDayTarget.requestId
    selectedMatchId.current = requestedFixtureId
  }

  contextRef.current = context
  userRef.current = user

  useEffect(() => {
    busyRef.current = busy || reconciling
  }, [busy, reconciling])

  useEffect(() => {
    matchRef.current = match
    selectedMatchId.current = match?.id || requestedFixtureId || ''
  }, [match, requestedFixtureId])

  const cache = useCallback(async (nextMatches, nextMatch, nextPlayers) => saveCoachOfflineResources(userRef.current.id, contextRef.current, { matchDayDetail: nextMatch || null, matchDayList: nextMatches, matchDayPlayers: nextPlayers }), [])
  const load = useCallback(async () => {
    if (loadInFlight.current || busyRef.current) return
    loadInFlight.current = true
    setError(''); setNotice(''); setLoading(true)
    const currentUser = userRef.current
    const currentContext = contextRef.current
    const selectionBeforeLoad = selectedMatchId.current
    const saved = await readCoachOfflineResources(currentUser.id, currentContext).catch(() => null)
    const hasCachedMatches = Array.isArray(saved?.resources?.matchDayList)
    const cachedMatch = saved?.resources?.matchDayDetail && typeof saved.resources.matchDayDetail === 'object'
      ? normalizeCoachMatchDay(saved.resources.matchDayDetail)
      : null
    if (hasCachedMatches) {
      setMatches(normalizeCachedMatches(saved.resources.matchDayList))
      setPlayers(Array.isArray(saved.resources.matchDayPlayers) ? saved.resources.matchDayPlayers : [])
      if (!selectionBeforeLoad && cachedMatch) {
        selectedMatchId.current = cachedMatch.id
        matchRef.current = cachedMatch
        setMatch(cachedMatch)
      }
      setStale(true)
      setLoading(false)
    }
    try {
      const [matchesResult, playersResult] = await Promise.allSettled([
        withMobileAsyncTimeout(() => getCoachMatchDayList(currentUser)),
        withMobileAsyncTimeout(() => getCoachPlayerList(currentUser)),
      ])
      if (matchesResult.status === 'rejected') throw matchesResult.reason
      const nextMatches = matchesResult.value
      const nextPlayers = playersResult.status === 'fulfilled'
        ? playersResult.value
        : Array.isArray(saved?.resources?.matchDayPlayers) ? saved.resources.matchDayPlayers : []
      setMatches(nextMatches); setPlayers(nextPlayers); setReconciling(false)
      const activeSelectionId = selectedMatchId.current
      let nextMatch = null
      if (activeSelectionId) {
        try {
          nextMatch = await withMobileAsyncTimeout(() => getCoachMatchDayDetail(currentUser, activeSelectionId))
        } catch (detailError) {
          const exactCachedMatch = cachedMatch?.id === activeSelectionId ? cachedMatch : null
          if (exactCachedMatch) {
            matchRef.current = exactCachedMatch
            setMatch(exactCachedMatch)
          } else if (matchRef.current?.id !== activeSelectionId) {
            matchRef.current = null
            setMatch(null)
          }
          setStale(true)
          setError(errorMessage(detailError, 'Fixture details could not be refreshed.'))
          await cache(nextMatches, exactCachedMatch, nextPlayers)
          return
        }
      }
      if (nextMatch && selectedMatchId.current === nextMatch.id) {
        matchRef.current = nextMatch
        setMatch(nextMatch)
        setScoreDraft({ away: String(nextMatch.awayScore), home: String(nextMatch.homeScore) })
      }
      setStale(false)
      await cache(nextMatches, nextMatch || matchRef.current, nextPlayers)
    } catch (loadError) {
      if (!hasCachedMatches) setError(errorMessage(loadError, 'Match Day could not be loaded.'))
    } finally {
      loadInFlight.current = false
      setLoading(false)
    }
  }, [cache])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!requestedFixtureId || loading || match?.id !== requestedFixtureId) return
    setPanel(isLiveMatch(match) ? 'live' : 'overview')
    onMatchDayTargetHandled?.()
  }, [loading, match, onMatchDayTargetHandled, requestedFixtureId])
  useEffect(() => {
    if (quickAction?.intent !== 'create-match') return
    setFixtureFormOpen(true)
    setError('')
    setNotice('')
    onRequestScrollTop?.()
    onQuickActionHandled?.()
  }, [onQuickActionHandled, onRequestScrollTop, quickAction])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appState.current
      if (nextState === 'background' && previousState !== 'background') backgroundedAt.current = Date.now()
      appState.current = nextState
      const returnedFromBackground = previousState === 'background' && nextState === 'active'
      if (returnedFromBackground && Date.now() - backgroundedAt.current >= 2500 && !busyRef.current) void load()
    })
    return () => subscription.remove()
  }, [load])
  useEffect(() => {
    if (!selectedMatchIsLive || stale || reconciling) return undefined
    const refreshId = setInterval(() => { if (!busyRef.current) void load() }, 15000)
    return () => clearInterval(refreshId)
  }, [load, match?.id, reconciling, selectedMatchIsLive, stale])

  const open = async (summary) => {
    selectedMatchId.current = summary.id
    setBusy(true); setError('')
    try { const detail = await withMobileAsyncTimeout(() => getCoachMatchDayDetail(user, summary.id)); matchRef.current = detail; setMatch(detail); setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) }); setEventForm(createCoachMatchDayEventForm('goal', detail)); setPanel(isLiveMatch(detail) ? 'live' : 'overview'); setStale(false); await cache(matches, detail, players) }
    catch (openError) { setError(errorMessage(openError, 'Fixture details could not be loaded.')) }
    finally { setBusy(false) }
  }
  const replace = async (operation, verify) => {
    setBusy(true); setError(''); setNotice(''); setReconciling(false)
    try {
      const detail = await operation()
      const nextMatches = matches.map((item) => item.id === detail.id ? detail : item)
      setMatch(detail); setMatches(nextMatches); setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) }); setStale(false)
      await cache(nextMatches, detail, players)
      return detail
    } catch (operationError) {
      setReconciling(true)
      let detail
      try {
        detail = await getCoachMatchDayDetail(user, match.id)
      } catch {
        setError(`${errorMessage(operationError, 'The Match Day result is uncertain.')} Refresh to reconcile with the server before retrying.`)
        throw operationError
      }
      const nextMatches = matches.map((item) => item.id === detail.id ? detail : item)
      setMatch(detail); setMatches(nextMatches); setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) }); setStale(false)
      await cache(nextMatches, detail, players).catch(() => {})
      setReconciling(false)
      if (verify?.(detail) === true) {
        setNotice('The server confirmed that the Match Day change was saved. No retry is needed.')
        return detail
      }
      setError(`${errorMessage(operationError, 'The Match Day change failed.')} The server confirmed it was not saved. Review the current state before retrying.`)
      throw operationError
    } finally { setBusy(false) }
  }
  const confirm = async () => { const action = pending; setPending(null); if (!action) return; try { await action.run() } catch { return } }
  const actions = getCoachMatchDayActions({ context, match, reconciling, stale })
  const submitEvent = async () => { const validated = validateCoachMatchDayEventForm(eventForm); const commandId = createCoachMatchDayCommandId(); await replace(() => recordCoachMatchDayEvent(user, match, validated, commandId), (detail) => hasCoachMatchDayCommandResult(detail, commandId)); setEventForm(createCoachMatchDayEventForm(validated.eventType, match)) }
  const handleFixtureCreated = async (result) => {
    setFixtureFormOpen(false)
    onRequestScrollTop?.()
    setNotice(result.invitationWarning || 'Fixture created. Match Day controls are ready.')
    const summary = normalizeCoachMatchDay(result.match)
    setMatches((current) => [summary, ...current.filter((item) => item.id !== summary.id)])
    try {
      const detail = await getCoachMatchDayDetail(user, summary.id)
      setMatch(detail)
      setPanel('overview')
      setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) })
    } catch {
      setMatch(summary)
    }
  }

  const closeFixture = () => {
    selectedMatchId.current = ''
    matchRef.current = null
    setMatch(null)
    setPanel('overview')
  }

  return <View style={styles.stack}>
    <Text accessibilityRole="header" style={styles.title}>Game Day</Text><Text style={styles.body}>Live fixture control with server-authoritative squad, clock, events, volunteers, shootout, and corrections.</Text>
    {!match ? <View style={styles.tabs}><Button label="Availability" onPress={() => onNavigate('invites')} secondary styles={styles} /><Button label="Team Chat" onPress={() => onNavigate('chat')} secondary styles={styles} /><Button label="Calendar" onPress={() => onNavigate('calendar')} secondary styles={styles} /></View> : null}
    {!match && !fixtureFormOpen && !stale && Number(context.roleRank || 0) >= 20 ? <Button label="Create match" onPress={() => { setFixtureFormOpen(true); setError(''); setNotice(''); onRequestScrollTop?.() }} styles={styles} /> : null}
    {fixtureFormOpen ? <CoachFixtureForm matches={matches} onCancel={() => { setFixtureFormOpen(false); onRequestScrollTop?.() }} onCreated={handleFixtureCreated} players={players} styles={styles} user={user} /> : null}
    {loading ? <View style={styles.card}><ActivityIndicator /><Text style={styles.body}>Loading authoritative Match Day data...</Text></View> : null}
    {reconciling ? <View accessibilityLiveRegion="assertive" style={styles.warning}><ActivityIndicator /><Text style={styles.cardTitle}>Reconciling the last action</Text><Text style={styles.body}>The current fixture remains visible, but changes are blocked until the server result is known.</Text></View> : null}
    {notice ? <View accessibilityLiveRegion="polite" style={styles.card}><Text style={styles.body}>{notice}</Text></View> : null}
    {error && !visibleError ? <View style={styles.card}><ActivityIndicator /><Text style={styles.body}>Checking for the latest Match Day information...</Text></View> : null}
    {visibleError ? <View style={styles.warning}><Text style={styles.dangerText}>{visibleError}</Text><Button label="Refresh" onPress={load} secondary styles={styles} /></View> : null}
    {confirmedStale ? <View style={styles.warning}><Text style={styles.cardTitle}>Offline read</Text><Text style={styles.body}>Showing encrypted cached Match Day data. Every change is disabled until a successful refresh.</Text></View> : null}
    {!fixtureFormOpen && !match ? <MatchList filter={filter} matches={matches} onOpen={open} selectedId={match?.id} setFilter={setFilter} styles={styles} /> : null}
    {match && !fixtureFormOpen ? <><Button label="Back to fixtures" onPress={closeFixture} secondary styles={styles} /><Chips onChange={setPanel} options={MATCH_DAY_PANEL_OPTIONS} styles={styles} value={panel} />
      {panel === 'overview' ? <View style={styles.stack}><FixtureHero match={match} styles={styles} /><View style={styles.card}><Text style={styles.cardTitle}>Fixture details</Text><Text style={styles.body}>{match.venueAddress || match.venueName || 'Venue TBC'}</Text>{match.notes ? <><Text style={styles.fieldLabel}>Match notes</Text><Text style={styles.body}>{match.notes}</Text></> : null}<Text style={styles.meta}>Clock {match.clockMode}, {match.matchDurationMinutes} minutes | Rule {label(match.conclusionRule, 'normal time')}</Text></View>{actions.timerActions.some((item) => item.action === 'start') ? <View style={styles.card}><Text style={styles.cardTitle}>Ready for kick-off?</Text><Text style={styles.body}>Start the authoritative match clock and open the live controller.</Text><Button disabled={busy || reconciling} label="Start match" onPress={() => setPending({ kind: 'timer', label: 'Start match', run: async () => { const detail = await replace(() => runCoachMatchDayTimerAction(user, match, 'start'), (nextDetail) => isCoachMatchDayTimerActionApplied(nextDetail, 'start')); setPanel('live'); return detail } })} styles={styles} /></View> : <Button label="Open Game Mode" onPress={() => setPanel('live')} styles={styles} />}</View> : null}
      {panel === 'squad' ? <SquadPanel actions={actions} busy={busy} match={match} onSetDecision={(player, decision) => setPending({ label: `Set ${player.playerName} to ${decision.replaceAll('_', ' ')}`, run: () => replace(() => setCoachMatchDaySquadDecision(user, match, player.id, decision, player.decidedAt || null), (detail) => isCoachMatchDaySquadDecisionApplied(detail, player.id, decision)) })} players={players} styles={styles} /> : null}
      {panel === 'formation' ? <CoachFormationBoard context={context} match={match} palette={palette} players={players} stale={stale} user={user} /> : null}
      {panel === 'volunteers' ? <VolunteerPanel actions={actions} busy={busy} match={match} onSelect={(request, role, selected) => setPending({ label: `${selected ? 'Assign' : 'Remove'} ${role}`, run: () => replace(() => selectCoachMatchDayVolunteer(user, match, request, role, selected), (detail) => isCoachMatchDayVolunteerSelectionApplied(detail, request, role, selected)) })} styles={styles} /> : null}
      {panel === 'live' ? <LivePanel actions={actions} busy={busy} eventForm={eventForm} match={match} onEventForm={setEventForm} onExit={() => setPanel('overview')} onPrepare={setPending} onScore={(kind) => { if (kind === 'event') return submitEvent(); const commandId = createCoachMatchDayCommandId(); return replace(() => correctCoachMatchDayScore(user, match, scoreDraft.home, scoreDraft.away, commandId), (detail) => hasCoachMatchDayCommandResult(detail, commandId)) }} onTimer={(action) => replace(() => runCoachMatchDayTimerAction(user, match, action), (detail) => isCoachMatchDayTimerActionApplied(detail, action))} scoreDraft={scoreDraft} setScoreDraft={setScoreDraft} styles={styles} /> : null}
      {panel === 'timeline' ? <TimelinePanel busy={busy || reconciling} match={match} onCorrectGoal={(event, goal, reason) => replace(() => correctCoachMatchDayGoal(user, match, event, goal, reason), (detail) => isCoachMatchDayGoalCorrectionApplied(detail, event.id, goal, reason))} onPrepare={setPending} onUndo={(event, input) => replace(() => voidCoachMatchDayEvent(user, match, event, input), (detail) => isCoachMatchDayEventVoided(detail, event.id))} styles={styles} /> : null}
      {panel === 'shootout' ? <ShootoutPanel busy={busy || reconciling} match={match} onKick={(kick) => { const priorKickIds = (match.shootoutEvents || []).map((item) => item.id); return replace(() => recordCoachMatchDayShootoutKick(user, match, kick), (detail) => isCoachMatchDayShootoutKickApplied(detail, priorKickIds, kick)) }} onPrepare={setPending} onVoid={(id) => replace(() => voidCoachMatchDayShootoutKick(user, match, id), (detail) => isCoachMatchDayShootoutKickVoided(detail, id))} styles={styles} /> : null}
      {panel === 'report' ? <ReportPanel busy={busy || reconciling} canSave={actions.canSaveFinalReport} key={`${match.id}:${match.finalReport?.updatedAt || ''}`} match={match} onSave={(notes) => setPending({ label: 'Save final Match Day report', run: () => replace(() => saveCoachMatchDayFinalReport(user, match, notes), (detail) => isCoachMatchDayFinalReportApplied(detail, notes)) })} styles={styles} /> : null}
    </> : null}
    <Modal animationType="fade" onRequestClose={() => setPending(null)} transparent visible={Boolean(pending)}><View accessibilityViewIsModal style={styles.modalScreen}><Pressable accessibilityLabel="Cancel Match Day change" onPress={() => setPending(null)} style={styles.modalBackdrop} /><View accessibilityLiveRegion="assertive" style={styles.modalCard}><Text style={styles.cardTitle}>Confirm Match Day change</Text><Text style={styles.body}>{pending?.label}</Text><Text style={styles.meta}>The server will recheck Team scope, role, payment, fixture state, and concurrency before saving. The full fixture will then be refreshed.</Text><Button disabled={busy || reconciling} label="Confirm" onPress={confirm} styles={styles} /><Button label="Cancel" onPress={() => setPending(null)} secondary styles={styles} /></View></View></Modal>
  </View>
}
