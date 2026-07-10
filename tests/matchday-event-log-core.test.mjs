import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { normalizeMatchDay } from '../src/lib/domain/match-day.js'

const migrationUrl = new URL('../supabase/migrations/20260704084216_match_day_event_log_core.sql', import.meta.url)
const matchEventTypesMigrationUrl = migrationSourceUrl('20260705074811_matchday_event_types_cards_subs_water.sql', 'active')
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const goalStateUrl = new URL('../src/lib/matchday-goal-state.js', import.meta.url)
const staffPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const selectVolunteerFunctionUrl = new URL('../netlify/functions/select-match-day-volunteer.js', import.meta.url)
const availabilityConfirmFunctionUrl = new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url)
const sendAvailabilityFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)

test('match day event log migration creates a staff scoped RLS table', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.match_day_event_log/i)
  assert.match(migration, /match_day_id uuid not null references public\.match_days/i)
  assert.match(migration, /player_id uuid references public\.players/i)
  assert.match(migration, /actor_user_id uuid references auth\.users/i)
  assert.match(migration, /previous_value jsonb/i)
  assert.match(migration, /new_value jsonb/i)
  assert.match(migration, /metadata jsonb not null default '\{\}'::jsonb/i)
  assert.match(migration, /event_type in \([\s\S]*'match_day_created'[\s\S]*'player_selected'[\s\S]*'player_availability_changed'[\s\S]*'match_role_assigned'[\s\S]*'scorer_updated'[\s\S]*'linesman_updated'[\s\S]*'invite_queued'[\s\S]*'note_updated'/i)
  assert.match(migration, /alter table public\.match_day_event_log enable row level security;/i)
  assert.match(migration, /alter table public\.match_day_event_log force row level security;/i)
  assert.match(migration, /revoke all on public\.match_day_event_log from anon;/i)
  assert.match(migration, /revoke all on public\.match_day_event_log from authenticated;/i)
  assert.match(migration, /grant select, insert on public\.match_day_event_log to authenticated;/i)
  assert.match(migration, /create policy match_day_event_log_staff_select_scoped[\s\S]*public\.can_read_match_day\(team_id\)/i)
  assert.match(migration, /create policy match_day_event_log_staff_insert_scoped[\s\S]*public\.can_manage_match_day\(team_id\)/i)
  assert.doesNotMatch(migration, /grant\s+select[\s\S]+to anon/i)
})

test('match day event log migration indexes timeline and player lookups', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /match_day_event_log_match_created_idx[\s\S]*match_day_id, created_at desc/i)
  assert.match(migration, /match_day_event_log_team_created_idx[\s\S]*club_id, team_id, created_at desc/i)
  assert.match(migration, /match_day_event_log_player_created_idx[\s\S]*where player_id is not null/i)
})

test('domain read model includes event log entries in Match Day payloads', async () => {
  const source = await readFile(domainUrl, 'utf8')

  assert.match(source, /function normalizeMatchDayEventLogEntry/)
  assert.match(source, /match_day_event_log \(\*, players:player_id \(player_name\)\)/)
  assert.match(source, /eventLog,/)

  const match = normalizeMatchDay({
    id: 'match-1',
    club_id: 'club-1',
    team_id: 'team-1',
    opponent: 'Riverside',
    match_day_event_log: [
      {
        id: 'log-1',
        match_day_id: 'match-1',
        event_type: 'match_day_created',
        event_label: 'Fixture created',
        actor_display_name: 'Coach One',
        players: { player_name: 'Ava Green' },
      },
    ],
  })

  assert.equal(match.eventLog.length, 1)
  assert.equal(match.eventLog[0].eventType, 'match_day_created')
  assert.equal(match.eventLog[0].eventLabel, 'Fixture created')
  assert.equal(match.eventLog[0].playerName, 'Ava Green')
})

test('domain writes event log entries after successful core Match Day actions only', async () => {
  const source = await readFile(domainUrl, 'utf8')

  assert.match(source, /export async function createMatchDayEventLogEntry/)
  assert.match(source, /\.from\('match_day_event_log'\)[\s\S]*\.insert\(/)
  assert.match(source, /console\.warn\('Match Day event log write failed'/)
  assert.match(source, /action: 'match_day_created'[\s\S]*await createMatchDayEventLogEntry\(\{[\s\S]*eventType: 'match_day_created'/)
  assert.match(source, /export async function updateMatchDay[\s\S]*const previousSnapshot = await getMatchDayEventLogSnapshot/)
  assert.match(source, /eventType === 'note_updated' \? 'Note updated' : 'Fixture updated'/)
  assert.match(source, /export async function addStaffMatchDayGoal[\s\S]*eventType: 'scorer_updated'/)
  assert.match(source, /return normalizeMatchDayEvent\(data\)/)
})

test('staff Match Day page renders a staff-only event log panel and empty state', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /const eventLog = Array\.isArray\(match\.eventLog\) \? match\.eventLog : \[\]/)
  assert.match(source, /<MatchDayEventLogPanel entries=\{eventLog\} \/>/)
  assert.match(source, /function MatchDayEventLogPanel/)
  assert.match(source, /No event log entries yet\./)
  assert.match(source, /New Match Day changes will appear here\./)
  assert.match(source, /getEventLogActorLabel/)
  assert.match(source, /getEventLogDetail/)
})

test('staff event log panel renders compact filters from existing entries only', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const panelStart = source.indexOf('function MatchDayEventLogPanel')
  const panelEnd = source.indexOf('function CompactFact', panelStart)
  const panelSource = source.slice(panelStart, panelEnd)

  assert.notEqual(panelStart, -1)
  assert.notEqual(panelEnd, -1)
  assert.match(source, /const EVENT_LOG_FILTERS = \[/)
  assert.match(source, /\{ key: 'all', label: 'All' \}/)
  assert.match(source, /\{ key: 'squad', label: 'Squad' \}/)
  assert.match(source, /\{ key: 'availability', label: 'Availability' \}/)
  assert.match(source, /\{ key: 'roles', label: 'Roles' \}/)
  assert.match(source, /\{ key: 'invites', label: 'Invites' \}/)
  assert.match(source, /\{ key: 'match', label: 'Match' \}/)
  assert.match(panelSource, /useState\('all'\)/)
  assert.match(panelSource, /const eventEntries = Array\.isArray\(entries\) \? entries : \[\]/)
  assert.match(panelSource, /count: filter\.key === 'all'[\s\S]*eventEntries\.length[\s\S]*getEventLogFilterKey\(entry\) === filter\.key/)
  assert.match(panelSource, /aria-label="Event log filters"/)
  assert.match(panelSource, /aria-pressed=\{isActive\}/)
  assert.match(panelSource, /setSelectedFilterKey\(filter\.key\)/)
  assert.match(panelSource, /No \{emptyFilterLabel\} entries yet\./)
  assert.match(panelSource, /Use All to see the full Match Day event log\./)
  assert.doesNotMatch(panelSource, /fetch\(/)
  assert.doesNotMatch(panelSource, /createMatchDayEventLogEntry/)
  assert.doesNotMatch(panelSource, /sendMatchDayPushNotification/)
  assert.doesNotMatch(panelSource, /scheduled_email_queue/)
  assert.doesNotMatch(panelSource, /localStorage/)
  assert.doesNotMatch(panelSource, /sessionStorage/)
})

test('staff Match Day page renders a staff-only match timeline from existing match events', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const panelStart = source.indexOf('function MatchTimelinePanel')
  const panelEnd = source.indexOf('function MatchDayReadinessPanel', panelStart)
  const panelSource = source.slice(panelStart, panelEnd)

  assert.notEqual(panelStart, -1)
  assert.notEqual(panelEnd, -1)
  assert.match(source, /<MatchTimelinePanel[\s\S]*events=\{events\}[\s\S]*match=\{match\}[\s\S]*onCorrectGoal=\{onCorrectGoal\}[\s\S]*onUndoEvent=\{onUndoEvent\}/)
  assert.match(source, /function getMatchEventTypeLabel\(event, match = \{\}\)/)
  assert.match(source, /function getMatchEventScoreLabel\(event\)/)
  assert.match(source, /function getMatchEventDetailItems\(event\)/)
  assert.match(source, /function formatMatchEventTimestamp\(value\)/)
  assert.match(source, /event\.teamSide === 'opponent' \? `\$\{opponentName\} goal` : 'Our goal'/)
  assert.match(source, /event\.teamSide === 'opponent' \? `\$\{opponentName\} yellow card` : 'Yellow card'/)
  assert.match(source, /event\.teamSide === 'opponent' \? `\$\{opponentName\} red card` : 'Red card'/)
  assert.match(source, /return 'Score correction'/)
  assert.match(source, /Score after event: \{getMatchEventScoreLabel\(event\)\}/)
  assert.match(source, /Scorer/)
  assert.match(source, /Assist/)
  assert.match(source, /Minute/)
  assert.match(source, /Note/)
  assert.match(source, /Recorded by/)
  assert.match(source, /Time/)
  assert.match(panelSource, /No match events yet\./)
  assert.match(panelSource, /Goals, cards and match actions will appear here once recorded\./)
  assert.match(panelSource, /const timelineEvents = getOrderedMatchTimelineEvents\(events\)/)
  assert.match(panelSource, /const visibleTimelineEvents = isExpanded \? timelineEvents : timelineEvents\.slice\(0, 3\)/)
  assert.match(panelSource, /visibleTimelineEvents\.map/)
  assert.match(panelSource, /Show all/)
  assert.match(panelSource, /Show less/)
  assert.doesNotMatch(panelSource, /slice\(0, 8\)/)
  assert.doesNotMatch(panelSource, /fetch\(/)
  assert.doesNotMatch(panelSource, /createMatchDayEventLogEntry/)
  assert.doesNotMatch(panelSource, /sendMatchDayPushNotification/)
  assert.doesNotMatch(panelSource, /scheduled_email_queue/)
})

test('staff add goal panel previews score impact and fallback details without new write paths', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const formStart = source.indexOf('function LiveMatchEntryModal')
  const formEnd = source.indexOf('function getMatchEventSortMinute', formStart)
  const handlerStart = source.indexOf('const handleAddGoal = async (event, match) => {')
  const handlerEnd = source.indexOf('const handleResetPrevious =', handlerStart)
  const formSource = source.slice(formStart, formEnd)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.notEqual(formStart, -1)
  assert.notEqual(formEnd, -1)
  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  assert.match(source, /function getStaffGoalScoreImpact\(match = \{\}, teamSide = 'club'\)/)
  assert.match(source, /if \(normalizedTeamSide === 'club'\)[\s\S]*homeAway === 'away'[\s\S]*nextAwayScore \+= 1[\s\S]*nextHomeScore \+= 1/)
  assert.match(source, /else if \(homeAway === 'away'\)[\s\S]*nextHomeScore \+= 1[\s\S]*nextAwayScore \+= 1/)
  assert.match(source, /function buildStaffGoalPreview\(match = \{\}, goalForm = \{\}\)/)
  assert.match(source, /scoreAfter: getMatchDayDisplayScore\(previewMatch\)/)
  assert.match(source, /scoreBefore: getMatchDayDisplayScore\(match\)/)
  assert.match(source, /No scorer selected/)
  assert.match(source, /No assist recorded/)
  assert.match(source, /Auto from match clock/)
  assert.match(source, /No note entered/)
  assert.match(formSource, /Score preview/)
  assert.match(formSource, /\{goalPreview\.scoreBefore\} to \{goalPreview\.scoreAfter\}/)
  assert.match(formSource, /Goal side/)
  assert.match(formSource, /<option value="club">Our team<\/option>/)
  assert.match(formSource, /<option value="opponent">Opponent<\/option>/)
  assert.match(formSource, /onGoalFormChange\(match\.id, getGoalSideFormReset\(event\.target\.value\)\)/)
  assert.match(formSource, /value=\{goalForm\.minute\}/)
  assert.match(formSource, /value=\{goalForm\.notes\}/)
  assert.match(formSource, /<DetailItem label="Scorer" value=\{goalPreview\.scorerPreview\} \/>/)
  assert.match(formSource, /<DetailItem label="Minute" value=\{goalPreview\.minutePreview\} \/>/)
  assert.match(handlerSource, /const formGoal = goalForms\[match\.id\] \?\? EMPTY_GOAL_FORM/)
  assert.match(handlerSource, /const resolvedMinute = resolveMatchDayEventMinute\({[\s\S]*manualMinute: formGoal\.minute/)
  assert.match(handlerSource, /minute: resolvedMinute\.minute \?\? ''/)
  assert.match(handlerSource, /setGoalForms\(\(currentForms\) => \(\{[\s\S]*\[match\.id\]: EMPTY_GOAL_FORM/)
  assert.match(handlerSource, /await loadData\(\)/)
  assert.doesNotMatch(formSource, /match_day_events/)
  assert.doesNotMatch(formSource, /createMatchDayEventLogEntry/)
  assert.doesNotMatch(formSource, /sendMatchDayPushNotification/)
  assert.doesNotMatch(formSource, /scheduled_email_queue/)
})

test('staff match timeline handles partial and unknown match events without new write paths', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /return 'Match update'/)
  assert.match(source, /return 'Score not recorded'/)
  assert.match(source, /return 'Time not recorded'/)
  assert.match(source, /event\.minute !== null && event\.minute !== undefined/)
  assert.match(source, /event\.notes \? \{ label: 'Note', value: event\.notes \} : null/)
  assert.match(source, /event\.createdByName \? \{ label: 'Recorded by', value: event\.createdByName \} : null/)
  assert.doesNotMatch(source, /\.from\('match_day_events'\)[\s\S]*\.insert\([\s\S]*function MatchTimelinePanel/)
})

test('Match Day event type migration adds cards substitutions and water breaks narrowly', async () => {
  const migration = await readFile(matchEventTypesMigrationUrl, 'utf8')

  assert.match(migration, /alter table public\.match_day_events[\s\S]*drop constraint if exists match_day_events_type_check/i)
  assert.match(migration, /event_type in \([\s\S]*'goal'[\s\S]*'score_correction'[\s\S]*'status_change'[\s\S]*'note'[\s\S]*'yellow_card'[\s\S]*'red_card'[\s\S]*'substitution'[\s\S]*'water_break'/i)
  assert.match(migration, /alter table public\.match_day_event_log[\s\S]*drop constraint if exists match_day_event_log_event_type_check/i)
  assert.match(migration, /match_day_event_log_event_type_check[\s\S]*'yellow_card'[\s\S]*'red_card'[\s\S]*'substitution'[\s\S]*'water_break'/i)
  assert.doesNotMatch(migration, /create table/i)
  assert.doesNotMatch(migration, /insert into/i)
  assert.doesNotMatch(migration, /update public\./i)
})

test('staff Match Day event model accepts and logs cards substitutions and water breaks only', async () => {
  const domain = await readFile(domainUrl, 'utf8')
  const goalState = await readFile(goalStateUrl, 'utf8')

  assert.match(domain, /const MATCH_DAY_STAFF_EVENT_TYPES = new Set\(\[[\s\S]*'yellow_card'[\s\S]*'red_card'[\s\S]*'substitution'[\s\S]*'water_break'/)
  assert.match(domain, /export async function addStaffMatchDayEvent/)
  assert.match(domain, /event_type: eventType/)
  assert.match(domain, /home_score: Number\(match\.homeScore \?\? 0\)/)
  assert.match(domain, /away_score: Number\(match\.awayScore \?\? 0\)/)
  assert.match(domain, /eventType,[\s\S]*eventLabel: getMatchDayEventLogLabel\(eventType\)/)
  assert.doesNotMatch(domain, /suspension|disciplinary|season card|card total|substitution statistics/i)
  assert.match(goalState, /export function reconcileMatchDayEvent/)
  assert.match(goalState, /event\.eventType \?\? event\.event_type/)
  assert.match(goalState, /scorerName: normalizeText\(event\.scorerName \?\? event\.scorer_name\)/)
})

test('staff Match Day page renders compact cards substitutions and water break controls and badges', async () => {
  const [source, domain] = await Promise.all([
    readFile(staffPageUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])
  const timelineStart = source.indexOf('function MatchTimelinePanel')
  const timelineEnd = source.indexOf('function MatchDayReadinessPanel', timelineStart)
  const timelineSource = source.slice(timelineStart, timelineEnd)

  assert.match(source, /const EMPTY_MATCH_EVENT_FORM = \{[\s\S]*eventType: 'yellow_card'/)
  assert.match(source, /const EMPTY_MATCH_EVENT_FORM = \{[\s\S]*teamSide: 'club'/)
  assert.match(source, /const MATCH_EVENT_TYPE_OPTIONS = \[[\s\S]*yellow_card[\s\S]*red_card[\s\S]*substitution[\s\S]*water_break/)
  assert.match(source, /const handleAddMatchEvent = async \(event, match\) =>/)
  assert.match(source, /const savedEvent = await addStaffMatchDayEvent\(\{ user, match, event: matchEvent \}\)/)
  assert.match(source, /reconcileMatchDayEventInList/)
  assert.doesNotMatch(source, /sendMatchDayPushNotification\(\{[\s\S]*type: 'yellow_card'/)
  assert.match(source, /Save event/)
  assert.match(source, /Player On/)
  assert.doesNotMatch(source, /Player On \/ note/)
  assert.match(domain, /home_score: Number\(match\.homeScore \?\? 0\)/)
  assert.match(domain, /away_score: Number\(match\.awayScore \?\? 0\)/)
  assert.match(source, /<span className=\{smallLabelClass\}>Team<\/span>[\s\S]*<option value="club">Our team<\/option>[\s\S]*<option value="opponent">Opponent<\/option>/)
  assert.match(timelineSource, /getMatchEventBadge\(event\)/)
  assert.match(timelineSource, /aria-label=\{badge\.label\}/)
  assert.match(source, /yellow_card: \{ label: 'Yellow card'/)
  assert.match(source, /red_card: \{ label: 'Red card'/)
  assert.match(source, /substitution: \{ label: 'Substitution'/)
  assert.match(source, /water_break: \{ label: 'Water break'/)
})

test('staff substitutions save Player Off and Player On as structured event person fields', async () => {
  const [source, domain] = await Promise.all([
    readFile(staffPageUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])
  const eventWriterStart = domain.indexOf('export async function addStaffMatchDayEvent')
  const eventWriterEnd = domain.indexOf('export async function addMatchDayGoalAsScorer', eventWriterStart)
  const eventWriterSource = domain.slice(eventWriterStart, eventWriterEnd)
  const detailStart = source.indexOf('function getMatchEventDetailItems(event)')
  const detailEnd = source.indexOf('function normalizeStaffGoalText', detailStart)
  const detailSource = source.slice(detailStart, detailEnd)

  assert.notEqual(eventWriterStart, -1)
  assert.notEqual(eventWriterEnd, -1)
  assert.notEqual(detailStart, -1)
  assert.notEqual(detailEnd, -1)
  assert.match(source, /const EMPTY_MATCH_EVENT_FORM = \{[\s\S]*playerId: ''[\s\S]*playerOnId: ''[\s\S]*playerOnName: ''[\s\S]*playerOnShirtNumber: ''/)
  assert.match(source, /playerOnSelect: 'Player On'[\s\S]*playerOnName: 'Player On name'[\s\S]*playerOnShirt: 'Player On shirt'/)
  assert.match(source, /onMatchEventPlayerPick\(match\.id, 'player', event\.target\.value\)/)
  assert.match(source, /onMatchEventPlayerPick\(match\.id, 'playerOn', event\.target\.value\)/)
  assert.match(source, /disabled=\{isSubstitutionEvent && String\(player\.id\) === String\(matchEventForm\.playerOnId\)\}/)
  assert.match(source, /disabled=\{String\(player\.id\) === String\(matchEventForm\.playerId\)\}/)
  assert.match(source, /Choose a different Player On for this substitution\./)
  assert.match(eventWriterSource, /const isSubstitution = eventType === 'substitution'/)
  assert.match(eventWriterSource, /scorer_name: normalizeText\(event\?\.playerName\)/)
  assert.match(eventWriterSource, /assist_name: isSubstitution \? normalizeText\(event\?\.playerOnName\) : ''/)
  assert.match(eventWriterSource, /assist_shirt_number: isSubstitution \? normalizeText\(event\?\.playerOnShirtNumber\) : ''/)
  assert.match(eventWriterSource, /playerOnName: payload\.assist_name/)
  assert.match(eventWriterSource, /return normalizeMatchDayEvent\(data\)/)
  assert.match(detailSource, /event\.eventType === 'substitution'/)
  assert.match(detailSource, /label: 'Player Off'/)
  assert.match(detailSource, /label: 'Player On'/)
  assert.doesNotMatch(detailSource, /label: 'Assist'[\s\S]*event\.eventType === 'substitution'/)
})

test('opponent match events can omit player names while using opponent labels', async () => {
  const [source, domain] = await Promise.all([
    readFile(staffPageUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])
  const eventWriterStart = domain.indexOf('export async function addStaffMatchDayEvent')
  const eventWriterEnd = domain.indexOf('export async function addMatchDayGoalAsScorer', eventWriterStart)
  const eventWriterSource = domain.slice(eventWriterStart, eventWriterEnd)
  const labelStart = source.indexOf('function getMatchEventTypeLabel(event, match = {})')
  const labelEnd = source.indexOf('function getMatchEventScoreLabel', labelStart)
  const labelSource = source.slice(labelStart, labelEnd)

  assert.notEqual(eventWriterStart, -1)
  assert.notEqual(eventWriterEnd, -1)
  assert.notEqual(labelStart, -1)
  assert.notEqual(labelEnd, -1)
  assert.match(eventWriterSource, /const teamSide = normalizeText\(event\?\.teamSide\) === 'opponent' \? 'opponent' : 'club'/)
  assert.match(eventWriterSource, /team_side: teamSide/)
  assert.match(eventWriterSource, /scorer_name: normalizeText\(event\?\.playerName\)/)
  assert.doesNotMatch(eventWriterSource, /playerName[\s\S]{0,80}throw new Error/)
  assert.match(source, /Opponent player name optional/)
  assert.match(source, /Opponent player on optional/)
  assert.match(source, /Opponent player details can stay blank/)
  assert.match(source, /playerSelect: null,[\s\S]*playerName: 'Opponent player name optional'[\s\S]*playerOnSelect: null/)
  assert.match(labelSource, /const opponentName = getOpponentMatchName\(match\)/)
  assert.match(labelSource, /event\.teamSide === 'opponent' \? `\$\{opponentName\} yellow card` : 'Yellow card'/)
  assert.match(labelSource, /event\.teamSide === 'opponent' \? `\$\{opponentName\} red card` : 'Red card'/)
  assert.match(labelSource, /event\.teamSide === 'opponent' \? `\$\{opponentName\} substitution` : 'Substitution'/)
})

test('staff event log filters map known and unknown event types safely', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /function getEventLogFilterKey\(entry\)/)
  assert.match(source, /player_selected: 'squad'/)
  assert.match(source, /player_deselected: 'squad'/)
  assert.match(source, /player_availability_changed: 'availability'/)
  assert.match(source, /invite_prepared: 'invites'/)
  assert.match(source, /invite_queued: 'invites'/)
  assert.match(source, /linesman_updated: 'roles'/)
  assert.match(source, /match_role_assigned: 'roles'/)
  assert.match(source, /match_role_removed: 'roles'/)
  assert.match(source, /match_day_created: 'match'/)
  assert.match(source, /match_day_updated: 'match'/)
  assert.match(source, /note_updated: 'match'/)
  assert.match(source, /scorer_updated: 'match'/)
  assert.match(source, /eventType\.includes\('fixture'\)/)
  assert.match(source, /eventType\.includes\('score'\)/)
  assert.match(source, /return 'other'/)
  assert.match(source, /const filteredEntries = activeFilter\.key === 'all'[\s\S]*\? eventEntries[\s\S]*: eventEntries\.filter\(\(entry\) => getEventLogFilterKey\(entry\) === activeFilter\.key\)/)
})

test('staff Match Day page renders a readiness panel from existing fixture data only', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const panelStart = source.indexOf('function MatchDayReadinessPanel')
  const panelEnd = source.indexOf('function MatchDayEventLogPanel', panelStart)
  const readinessStart = source.indexOf('function getAvailabilityRequestStateLabel')
  const readinessEnd = source.indexOf('function getNeedsAttentionItems', readinessStart)

  assert.notEqual(panelStart, -1)
  assert.notEqual(panelEnd, -1)
  assert.notEqual(readinessStart, -1)
  assert.notEqual(readinessEnd, -1)

  const panelSource = source.slice(panelStart, panelEnd)
  const readinessSource = source.slice(readinessStart, readinessEnd)

  assert.match(source, /<MatchDayReadinessPanel match=\{match\} \/>/)
  assert.match(source, /function getMatchDaySetupReadiness/)
  assert.match(source, /function getMatchDayVisibilityReadiness/)
  assert.match(source, /function getMatchDayAvailabilityReadiness/)
  assert.match(source, /function getMatchDayRoleReadiness/)
  assert.match(source, /function getMatchDayLatestSignalReadiness/)
  assert.match(panelSource, /Match readiness/)
  assert.match(readinessSource, /Fixture details present/)
  assert.match(readinessSource, /Visible to parents/)
  assert.match(readinessSource, /Not visible to parents/)
  assert.match(readinessSource, /No availability request queued/)
  assert.match(readinessSource, /No responses yet/)
  assert.match(readinessSource, /No event log entries yet/)
  assert.match(readinessSource, /getEventLogTypeLabel\(latestEntry\)/)
  assert.match(readinessSource, /getRoleStatus\(match, role\.key\)/)
  assert.doesNotMatch(panelSource, /fetch\(/)
  assert.doesNotMatch(readinessSource, /fetch\(/)
  assert.doesNotMatch(panelSource, /createMatchDayEventLogEntry/)
  assert.doesNotMatch(readinessSource, /createMatchDayEventLogEntry/)
  assert.doesNotMatch(panelSource, /sendMatchDayPushNotification/)
  assert.doesNotMatch(readinessSource, /sendMatchDayPushNotification/)
})

test('staff fixture squad selection logs safe player selected and deselected entries', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /createMatchDayEventLogEntry,/)
  assert.match(source, /async function logFixtureSquadSelectionEvents/)
  assert.match(source, /eventType: 'player_selected'/)
  assert.match(source, /eventType: 'player_deselected'/)
  assert.match(source, /source: 'staff_fixture_squad_selection'/)
  assert.match(source, /selectionMode === 'individual'[\s\S]*deselectedPlayers/)
  assert.match(source, /await logFixtureSquadSelectionEvents\(\{[\s\S]*selectedPlayerIds,[\s\S]*selectionMode,[\s\S]*user,/)
})

test('staff squad selection can reselect a player after deselection before saving', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /const selectedIds = new Set\(current\.selectedPlayerIds\)/)
  assert.match(source, /if \(selectedIds\.has\(playerId\)\) \{[\s\S]*selectedIds\.delete\(playerId\)[\s\S]*\} else \{[\s\S]*selectedIds\.add\(playerId\)/)
  assert.match(source, /selectedPlayerIds: \[\.\.\.selectedIds\]/)
})

test('server volunteer selection logs role changes without changing email queue behavior', async () => {
  const source = await readFile(selectVolunteerFunctionUrl, 'utf8')

  assert.match(source, /async function createMatchDayEventLogEntry/)
  assert.match(source, /\.from\('match_day_event_log'\)[\s\S]*\.insert\(/)
  assert.match(source, /event_type: eventType/)
  assert.match(source, /eventLabel/)
  assert.match(source, /role === 'linesman'[\s\S]*'linesman_updated'/)
  assert.match(source, /action: isRemoved \? 'removed' : 'assigned'/)
  assert.match(source, /notificationQueuedCount: queuedNotifications\.length/)
  assert.match(source, /source: 'select_match_day_volunteer'/)
  assert.match(source, /console\.warn\('Match Day event log write failed'/)
  assert.match(source, /\.from\('scheduled_email_queue'\)[\s\S]*\.insert\(/)
  assert.match(source, /Volunteer selection was saved, but notification email could not be queued\./)
  assert.doesNotMatch(source, /sendEmail\(/)
})

test('availability invite preparation and queueing logs do not create new queue behavior', async () => {
  const source = await readFile(sendAvailabilityFunctionUrl, 'utf8')

  assert.match(source, /async function createMatchDayEventLogEntry/)
  assert.match(source, /eventType: 'invite_prepared'/)
  assert.match(source, /eventType: 'invite_queued'/)
  assert.match(source, /source: 'send_match_day_availability_requests'/)
  assert.match(source, /\.from\('scheduled_email_queue'\)[\s\S]*\.insert\(/)
  assert.match(source, /queuedEmails\.push\(queuedEmail\)/)
  assert.doesNotMatch(source, /sendEmail\(/)
  assert.doesNotMatch(source, /recipientEmail: contact\.email[\s\S]*match_day_event_log/)
})

test('parent availability response logging uses safe public-token metadata', async () => {
  const source = await readFile(availabilityConfirmFunctionUrl, 'utf8')

  assert.match(source, /createSupabaseAdminClient/)
  assert.match(source, /async function createAvailabilityEventLogEntry/)
  assert.match(source, /event_type: 'player_availability_changed'/)
  assert.match(source, /actor_display_name: actorUserId \? 'Parent response' : 'Public response link'/)
  assert.match(source, /actor_role: actorUserId \? 'parent_portal' : 'public_token'/)
  assert.match(source, /source: 'match_day_availability_confirm'/)
  assert.match(source, /previous_value: previousStatus/)
  assert.doesNotMatch(source, /recipient_email[\s\S]*metadata/)
})

test('event log UI renders Batch 2 event types with safe details', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /function getEventLogTypeLabel/)
  assert.match(source, /invite_prepared: 'invite prepared'/)
  assert.match(source, /invite_queued: 'invite queued'/)
  assert.match(source, /linesman_updated: 'linesman'/)
  assert.match(source, /player_availability_changed: 'availability'/)
  assert.match(source, /Availability: \$\{previousStatus \|\| 'not recorded'\} to \$\{nextStatus \|\| 'not recorded'\}/)
  assert.match(source, /Notifications queued: \$\{Number\(entry\.metadata\.notificationQueuedCount\)\}/)
})

test('parent portal does not expose the staff event log in this batch', async () => {
  const parentSource = await readFile(parentPortalPageUrl, 'utf8')
  const staffSource = await readFile(staffPageUrl, 'utf8')

  assert.doesNotMatch(parentSource, /match_day_event_log/i)
  assert.doesNotMatch(parentSource, /Event Log/)
  assert.doesNotMatch(parentSource, /Match readiness/)
  assert.doesNotMatch(parentSource, /No availability request queued/)
  assert.doesNotMatch(parentSource, /Match Timeline/)
  assert.doesNotMatch(parentSource, /No match events yet\./)
  assert.doesNotMatch(parentSource, /Result if saved/)
  assert.doesNotMatch(parentSource, /Score preview/)
  assert.match(staffSource, /Event Log/)
  assert.match(staffSource, /Match readiness/)
  assert.match(staffSource, /Match Timeline/)
  assert.match(staffSource, /Score preview/)
})
