import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import {
  buildCoachCalendarMonth,
  coachCalendarFormFromEvent,
  filterCoachCalendarEvents,
  formatCoachCalendarEventDateTime,
  getCoachCalendarContextModel,
  getCoachCalendarMonthKey,
  getCoachCalendarMutationPolicy,
  groupCoachCalendarEvents,
  formatCoachCalendarFormDate,
  shiftCoachCalendarMonth,
} from '../../mobile-core/src/coachCalendarCore'
import { getCoachCalendarResources, saveCoachCalendarEvent, saveCoachTrainingInvitation } from '../../mobile-core/src/coachCalendarData'
import {
  coachPlayerFormFromPlayer,
  filterCoachPlayers,
  getCoachPlayerMutationPolicy,
} from '../../mobile-core/src/coachPlayersCore'
import { getCoachPlayerDetail, getCoachPlayerList, saveCoachPlayer } from '../../mobile-core/src/coachPlayersData'
import {
  coachSessionFormFromSession,
  filterCoachSessions,
  getCoachSessionMutationPolicy,
} from '../../mobile-core/src/coachSessionsCore'
import {
  addCoachSessionPlayers,
  completeCoachSession,
  getCoachSessionDetail,
  getCoachSessionList,
  saveCoachSession,
  updateCoachSessionPlayerNotes,
} from '../../mobile-core/src/coachSessionsData'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import { CoachDateTimeField } from './CoachDateTimeField'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'

const message = getCoachFriendlyError

function useDomainStyles(palette) {
  return useMemo(() => StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 12, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
    actionDisabled: { opacity: 0.45 },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900' },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 20 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 16, borderWidth: 1, gap: 8, padding: 14 },
    calendar: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 16, borderWidth: 1, gap: 10, padding: 10 },
    calendarDay: { alignItems: 'center', borderColor: 'transparent', borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 52, paddingVertical: 5 },
    calendarDayOutside: { opacity: 0.38 },
    calendarDaySelected: { backgroundColor: palette.selected, borderColor: palette.accent },
    calendarDayToday: { borderColor: palette.accent },
    calendarDayText: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    calendarDayTextSelected: { color: palette.selectedForeground },
    calendarEventCount: { color: palette.accent, fontSize: 10, fontWeight: '900', minHeight: 13 },
    calendarHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    calendarMonth: { color: palette.textPrimary, flex: 1, fontSize: 17, fontWeight: '900', textAlign: 'center' },
    calendarNav: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 40, minWidth: 74, paddingHorizontal: 8 },
    calendarNavText: { color: palette.textPrimary, fontSize: 12, fontWeight: '900' },
    calendarWeek: { flexDirection: 'row', gap: 4 },
    calendarWeekday: { color: palette.textMuted, flex: 1, fontSize: 10, fontWeight: '900', textAlign: 'center' },
    chip: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 13 },
    chipActive: { backgroundColor: palette.selected, borderColor: palette.accent },
    chipText: { color: palette.textSecondary, fontSize: 12, fontWeight: '800' },
    chipTextActive: { color: palette.selectedForeground },
    danger: { color: palette.danger, fontSize: 13, fontWeight: '800', lineHeight: 19 },
    field: { gap: 5 },
    fieldLabel: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    form: { backgroundColor: palette.surface, borderColor: palette.accent, borderRadius: 16, borderWidth: 1, gap: 12, padding: 14 },
    input: { backgroundColor: palette.background, borderColor: palette.border, borderRadius: 12, borderWidth: 1, color: palette.textPrimary, fontSize: 15, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
    inputText: { color: palette.textPrimary, fontSize: 15 },
    inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
    label: { color: palette.textMuted, fontSize: 12, fontWeight: '800' },
    meta: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 17 },
    pickerActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
    pickerButton: { alignItems: 'center', borderColor: palette.border, borderRadius: 10, borderWidth: 1, minHeight: 42, justifyContent: 'center', minWidth: 88, paddingHorizontal: 12 },
    pickerButtonText: { color: palette.accent, fontSize: 14, fontWeight: '900' },
    pickerPanel: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, gap: 8, overflow: 'hidden', padding: 8 },
    row: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13, paddingVertical: 9 },
    secondaryText: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    stack: { gap: 12 },
    title: { color: palette.textPrimary, fontSize: 27, fontWeight: '900' },
    cardTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    warning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 14, borderWidth: 1, gap: 4, padding: 12 },
    warningText: { color: palette.warning, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  }), [palette])
}

function Button({ disabled = false, label, onPress, secondary = false, styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [secondary ? styles.secondary : styles.action, disabled && styles.actionDisabled, pressed && { opacity: 0.75 }]}
    >
      <Text style={secondary ? styles.secondaryText : styles.actionText}>{label}</Text>
    </Pressable>
  )
}

function Field({ label, multiline = false, onChangeText, styles, value }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[styles.input, multiline && styles.inputMultiline]}
        value={String(value ?? '')}
      />
    </View>
  )
}

function Chips({ onChange, options, styles, value }) {
  return (
    <View style={styles.filterRow}>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <Pressable accessibilityRole="button" accessibilityState={{ selected }} key={option.value} onPress={() => onChange(option.value)} style={[styles.chip, selected && styles.chipActive]}>
            <Text style={[styles.chipText, selected && styles.chipTextActive]}>{option.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function getSavedLocationOptions(events = []) {
  const seen = new Set()
  return [...events]
    .sort((left, right) => new Date(right?.startsAt || 0) - new Date(left?.startsAt || 0))
    .map((event) => String(event?.location || '').trim())
    .filter((location) => {
      const key = location.toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 8)
}

function LocationField({ label = 'Location', locations, onChange, styles, value }) {
  return (
    <View style={styles.stack}>
      {locations.length ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Saved locations</Text>
          <Chips onChange={onChange} options={locations.map((location) => ({ label: location, value: location }))} styles={styles} value={value} />
        </View>
      ) : null}
      <Field label={label} onChangeText={onChange} styles={styles} value={value} />
      <Text style={styles.meta}>Choose a saved location or type a different one.</Text>
    </View>
  )
}

function DomainHeader({ copy, styles, title }) {
  return <View style={styles.stack}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.body}>{copy}</Text></View>
}

function DomainState({ error, loading, onRetry, stale, styles }) {
  if (loading) return <View style={styles.card}><ActivityIndicator /><Text style={styles.body}>Loading...</Text></View>
  if (error) return <View style={styles.warning}><Text style={styles.danger}>{error}</Text>{onRetry ? <Button label="Try again" onPress={onRetry} secondary styles={styles} /> : null}</View>
  if (stale) return <View style={styles.warning}><Text style={styles.cardTitle}>You are offline</Text><Text style={styles.body}>Showing saved information. Connect before making changes.</Text></View>
  return null
}

export function CoachCalendarScreen({ context, contexts, onNavigate, onQuickActionHandled, onSelectContext, palette, quickAction, user }) {
  const styles = useDomainStyles(palette)
  const [events, setEvents] = useState([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('upcoming')
  const [form, setForm] = useState(null)
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(true)
  const [players, setPlayers] = useState([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [saveConfirmation, setSaveConfirmation] = useState('')
  const [stale, setStale] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => getCoachCalendarMonthKey())
  const contextModel = getCoachCalendarContextModel({ context, contexts })
  const policy = getCoachCalendarMutationPolicy({ context, event: selected })

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    const cached = await readCoachOfflineResources(user.id, context).catch(() => null)
    const hasCachedCalendar = Array.isArray(cached?.resources?.calendar)
    if (hasCachedCalendar) {
      setEvents(cached.resources.calendar)
      setPlayers(Array.isArray(cached.resources.calendarPlayers) ? cached.resources.calendarPlayers : [])
      setStale(true)
      setLoading(false)
    }
    try {
      const [rows, playerRows] = await Promise.all([
        getCoachCalendarResources(user),
        user.activeTeamId ? getCoachPlayerList(user) : Promise.resolve([]),
      ])
      setEvents(rows)
      setPlayers(playerRows)
      setStale(false)
      await saveCoachOfflineResources(user.id, context, { calendar: rows, calendarPlayers: playerRows })
    } catch (loadError) {
      if (!hasCachedCalendar) setError(message(loadError, 'Calendar could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [context, user])

  useEffect(() => { void load() }, [load])
  const calendarMonth = useMemo(
    () => buildCoachCalendarMonth(events, visibleMonth, selectedDate),
    [events, selectedDate, visibleMonth],
  )
  const selectedDay = calendarMonth.days.find((day) => day.date === selectedDate)
  const savedLocations = useMemo(() => getSavedLocationOptions(events), [events])
  const visibleEvents = selectedDate
    ? events.filter((event) => event.calendarDate === selectedDate)
    : filterCoachCalendarEvents(events, filter)
  const groups = groupCoachCalendarEvents(visibleEvents)
  const openForm = (event = null) => {
    setFormError('')
    setSaveConfirmation('')
    setSelected(event)
    const nextForm = coachCalendarFormFromEvent(event, context)
    setForm({
      ...nextForm,
      ...(!event && selectedDate ? { date: formatCoachCalendarFormDate(selectedDate) } : {}),
      ...(!event && !nextForm.location && savedLocations[0] ? { location: savedLocations[0] } : {}),
    })
  }
  useEffect(() => {
    if (quickAction?.route !== 'calendar') return
    setSelected(null)
    setFormError('')
    setSaveConfirmation('')
    const nextForm = coachCalendarFormFromEvent(null, context)
    setForm({ ...nextForm, ...(!nextForm.location && savedLocations[0] ? { location: savedLocations[0] } : {}) })
    onQuickActionHandled?.()
  }, [context, onQuickActionHandled, quickAction, savedLocations])
  const save = async () => {
    Keyboard.dismiss()
    setSaving(true)
    setError('')
    setFormError('')
    setSaveConfirmation('')
    try {
      await saveCoachCalendarEvent(user, form, selected)
      setSaveConfirmation(form?.eventType === 'match' ? 'Match saved.' : 'Event saved.')
      setForm(null)
      setSelected(null)
      await load()
    } catch (saveError) {
      setFormError(message(saveError, 'Calendar event could not be saved.'))
    } finally { setSaving(false) }
  }

  return (
    <View style={styles.stack}>
      <DomainHeader copy="Calendar events, Match Day fixtures, Sessions, recurrence, and training availability in Europe/London time." styles={styles} title="Calendar" />
      <View accessibilityLabel={`${calendarMonth.title} Calendar`} style={styles.calendar}>
        <View style={styles.calendarHeader}>
          <Pressable accessibilityRole="button" onPress={() => setVisibleMonth(shiftCoachCalendarMonth(visibleMonth, -1))} style={styles.calendarNav}>
            <Text style={styles.calendarNavText}>Previous</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.calendarMonth}>{calendarMonth.title}</Text>
          <Pressable accessibilityRole="button" onPress={() => setVisibleMonth(shiftCoachCalendarMonth(visibleMonth, 1))} style={styles.calendarNav}>
            <Text style={styles.calendarNavText}>Next</Text>
          </Pressable>
        </View>
        <View style={styles.calendarWeek}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <Text key={day} style={styles.calendarWeekday}>{day}</Text>)}
        </View>
        {calendarMonth.weeks.map((week) => (
          <View key={week[0].date} style={styles.calendarWeek}>
            {week.map((day) => (
              <Pressable
                accessibilityLabel={`${day.dateLabel}, ${day.events.length} ${day.events.length === 1 ? 'event' : 'events'}`}
                accessibilityRole="button"
                accessibilityState={{ selected: day.isSelected }}
                key={day.date}
                onPress={() => {
                  setSelectedDate(day.date)
                  if (!form) setSelected(null)
                  if (!day.inMonth) setVisibleMonth(day.date.slice(0, 7))
                }}
                style={[styles.calendarDay, !day.inMonth && styles.calendarDayOutside, day.isToday && styles.calendarDayToday, day.isSelected && styles.calendarDaySelected]}
              >
                <Text style={[styles.calendarDayText, day.isSelected && styles.calendarDayTextSelected]}>{day.dayNumber}</Text>
                <Text style={[styles.calendarEventCount, day.isSelected && styles.calendarDayTextSelected]}>{day.events.length || ''}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        <View style={styles.filterRow}>
          <Button label="Today" onPress={() => { setVisibleMonth(calendarMonth.today.slice(0, 7)); setSelectedDate(calendarMonth.today) }} secondary styles={styles} />
          {selectedDate ? <Button label="Show all dates" onPress={() => { setSelectedDate(''); if (!form) setSelected(null) }} secondary styles={styles} /> : null}
        </View>
      </View>
      {selectedDate ? (
        <View style={styles.card}>
          <Text style={styles.label}>Selected day</Text>
          <Text style={styles.cardTitle}>{selectedDay?.dateLabel || selectedDate}</Text>
          <Text style={styles.body}>{visibleEvents.length} {visibleEvents.length === 1 ? 'Calendar item' : 'Calendar items'}</Text>
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.label}>Calendar scope</Text>
        <Text style={styles.cardTitle}>{contextModel.currentLabel}</Text>
        <Text style={styles.body}>{contextModel.isTeamScope
          ? 'Assessment sessions for this authorised Team appear in Upcoming, Cancelled, or History according to their status.'
          : 'Club Calendar items are shown here. Assessment sessions are Team-scoped, so choose an authorised Team to see them.'}</Text>
        {contextModel.options.length > 1 ? (
          <View style={styles.stack}>
            <Text style={styles.fieldLabel}>{contextModel.teamContextCount > 1 ? 'Choose Calendar Team' : 'Choose Calendar scope'}</Text>
            <Chips
              onChange={onSelectContext}
              options={contextModel.options.map((option) => ({ label: option.label, value: option.id }))}
              styles={styles}
              value={contextModel.selectedContextId}
            />
          </View>
        ) : null}
        {contextModel.isTeamScope ? (
          <View style={styles.filterRow}>
            <Button label="Open Assessment Sessions" onPress={() => onNavigate('sessions')} secondary styles={styles} />
            <Button label="Open Development" onPress={() => onNavigate('development')} secondary styles={styles} />
          </View>
        ) : null}
      </View>
      <DomainState error={error} loading={loading} onRetry={load} stale={stale} styles={styles} />
      {saveConfirmation ? <View style={styles.card}><Text style={styles.cardTitle}>{saveConfirmation}</Text></View> : null}
      {!selectedDate ? <Chips onChange={setFilter} options={[{ label: 'Upcoming', value: 'upcoming' }, { label: 'History', value: 'history' }, { label: 'Cancelled', value: 'cancelled' }, { label: 'All', value: 'all' }]} styles={styles} value={filter} /> : null}
      {policy.canCreate && !stale && !form ? <Button label="Create event" onPress={() => openForm()} styles={styles} /> : null}
      {form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{selected ? 'Edit event' : 'Create event'}</Text>
          <Chips onChange={(value) => setForm({ ...form, eventType: value })} options={['general', 'training', 'match', 'meeting', 'tournament', 'social', 'other'].map((value) => ({ label: value, value }))} styles={styles} value={form.eventType} />
          {form.eventType === 'match'
            ? <Field label="Opponent" onChangeText={(value) => setForm({ ...form, opponent: value })} styles={styles} value={form.opponent} />
            : <Field label="Title" onChangeText={(value) => setForm({ ...form, title: value })} styles={styles} value={form.title} />}
          <CoachDateTimeField label="Date" mode="date" onChange={(value) => setForm({ ...form, date: value })} styles={styles} value={form.date} />
          <CoachDateTimeField label="Start time" mode="time" onChange={(value) => setForm({ ...form, startTime: value })} styles={styles} value={form.startTime} />
          <CoachDateTimeField label="End time" mode="time" onChange={(value) => setForm({ ...form, endTime: value })} styles={styles} value={form.endTime} />
          <LocationField locations={savedLocations} onChange={(value) => setForm({ ...form, location: value })} styles={styles} value={form.location} />
          <Field label="Notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} />
          {form.eventType !== 'match' ? <><Text style={styles.fieldLabel}>Repeat</Text><Chips onChange={(value) => setForm({ ...form, recurrenceFrequency: value })} options={['none', 'weekly', 'fortnightly', 'monthly'].map((value) => ({ label: value, value }))} styles={styles} value={form.recurrenceFrequency} />{form.recurrenceFrequency !== 'none' ? <CoachDateTimeField label="Repeat until" mode="date" onChange={(value) => setForm({ ...form, recurrenceUntil: value })} styles={styles} value={form.recurrenceUntil} /> : null}</> : null}
          <View style={styles.row}><Text style={styles.fieldLabel}>Visible to parents</Text><Switch accessibilityLabel="Visible to parents" onValueChange={(value) => setForm({ ...form, parentVisible: value })} value={form.parentVisible} /></View>
          {form.parentVisible ? <Chips onChange={(value) => setForm({ ...form, parentAudience: value })} options={[{ label: 'Involved Players', value: 'involved_players' }, { label: 'Team parents', value: 'all_team_parents' }, ...(context.role === 'admin' ? [{ label: 'Club parents', value: 'all_club_parents' }] : [])]} styles={styles} value={form.parentAudience} /> : null}
          {form.parentVisible && form.parentAudience === 'involved_players' ? (
            <View style={styles.stack}>
              <Text style={styles.fieldLabel}>Involved Players</Text>
              {players.map((player) => {
                const selectedPlayer = form.involvedPlayerIds.includes(player.id)
                return <Button key={player.id} label={`${selectedPlayer ? 'Remove' : 'Add'} ${player.playerName}`} onPress={() => setForm({ ...form, involvedPlayerIds: selectedPlayer ? form.involvedPlayerIds.filter((id) => id !== player.id) : [...form.involvedPlayerIds, player.id] })} secondary styles={styles} />
              })}
              {players.length === 0 ? <Text style={styles.body}>No active Players are available in this Team context.</Text> : null}
            </View>
          ) : null}
          {formError ? <View accessibilityRole="alert" style={styles.warning}><Text style={styles.danger}>{formError}</Text></View> : null}
          <Button disabled={saving || stale} label={saving ? 'Saving...' : 'Save event'} onPress={save} styles={styles} />
          <Button label="Cancel" onPress={() => { setForm(null); setFormError(''); setSelected(null) }} secondary styles={styles} />
        </View>
      ) : null}
      {!loading && groups.length === 0 ? <Text style={styles.body}>No Calendar items match this filter.</Text> : null}
      {groups.map((group) => (
        <View key={group.date} style={styles.stack}>
          <Text style={styles.label}>{group.date}</Text>
          {group.events.map((event) => (
            <Pressable accessibilityRole="button" key={event.id} onPress={() => setSelected(selected?.id === event.id ? null : event)} style={styles.card}>
              <Text style={styles.cardTitle}>{event.title}</Text>
              <Text style={styles.meta}>{formatCoachCalendarEventDateTime(event)} | {event.eventType} | {event.teamName || context.teamName || 'Club-wide'} | {event.status}</Text>
              {event.dateTimeIssue === 'invalid_local_time' ? <Text style={styles.warningText}>Please update this event's time before editing it.</Text> : null}
              {event.location ? <Text style={styles.body}>{event.location}</Text> : null}
              {event.availabilitySummary ? <Text style={styles.meta}>Available {event.availabilitySummary.available} | Maybe {event.availabilitySummary.maybe} | Unavailable {event.availabilitySummary.unavailable} | Pending {event.availabilitySummary.pending}</Text> : null}
              {selected?.id === event.id ? <><Text style={styles.body}>{event.notes || 'No notes.'}</Text>{event.sourceType === 'match_day' ? <Button label="Open Match Day" onPress={() => onNavigate('matchday', { fixtureId: event.sourceId })} secondary styles={styles} /> : null}{event.sourceType === 'assessment_session' ? <View style={styles.filterRow}><Button label="Open Session" onPress={() => onNavigate('sessions')} secondary styles={styles} /><Button label="Open Development" onPress={() => onNavigate('development')} secondary styles={styles} /></View> : null}{!stale && getCoachCalendarMutationPolicy({ context, event }).canEdit ? <Button label="Edit event" onPress={() => openForm(event)} secondary styles={styles} /> : event.sourceType !== 'calendar_event' ? <Text style={styles.meta}>Edit this item from its {event.sourceType === 'match_day' ? 'Match Day' : event.sourceType === 'assessment_session' ? 'Assessment Session' : 'web'} screen.</Text> : null}</> : null}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  )
}

export function CoachPlayersScreen({ context, onNavigate, onQuickActionHandled, palette, quickAction, user }) {
  const styles = useDomainStyles(palette)
  const [players, setPlayers] = useState([])
  const [detail, setDetail] = useState(null)
  const [developmentOpen, setDevelopmentOpen] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState('all')
  const [saving, setSaving] = useState(false)
  const [stale, setStale] = useState(false)
  const policy = getCoachPlayerMutationPolicy({ context, player: detail?.player })
  const load = useCallback(async () => {
    setError(''); setLoading(true)
    const cached = await readCoachOfflineResources(user.id, context).catch(() => null)
    const hasCachedPlayers = Array.isArray(cached?.resources?.players)
    if (hasCachedPlayers) { setPlayers(cached.resources.players); setStale(true); setLoading(false) }
    try {
      const rows = await getCoachPlayerList(user)
      setPlayers(rows); setStale(false)
      await saveCoachOfflineResources(user.id, context, { players: rows })
    } catch (loadError) {
      if (!hasCachedPlayers) setError(message(loadError, 'Players could not be loaded.'))
    } finally { setLoading(false) }
  }, [context, user])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (quickAction?.intent !== 'create-player') return
    setDetail(null)
    setForm(coachPlayerFormFromPlayer())
    onQuickActionHandled?.()
  }, [onQuickActionHandled, quickAction])
  const visible = filterCoachPlayers(players, { query, section, status: 'active' })
  const openPlayer = async (player) => {
    setError('')
    setDevelopmentOpen(false)
    try { setDetail(await getCoachPlayerDetail(user, player.id)) }
    catch (detailError) { setError(message(detailError, 'Player details could not be loaded.')) }
  }
  const save = async () => {
    setSaving(true); setError('')
    try {
      await saveCoachPlayer(user, form, detail?.player || null)
      setForm(null); setDetail(null); await load()
    } catch (saveError) { setError(message(saveError, 'Player could not be saved.')) }
    finally { setSaving(false) }
  }
  return (
    <View style={styles.stack}>
      <DomainHeader copy="Team-scoped Player records, contact details, Development history, and canonical custom fields." styles={styles} title="Players" />
      <DomainState error={error} loading={loading} onRetry={load} stale={stale} styles={styles} />
      <Field label="Search Players" onChangeText={setQuery} styles={styles} value={query} />
      <Chips onChange={setSection} options={[{ label: 'All', value: 'all' }, { label: 'Trial', value: 'Trial' }, { label: 'Squad', value: 'Squad' }]} styles={styles} value={section} />
      {policy.canCreate && !form ? <Button label="Add Player" onPress={() => { setDetail(null); setForm(coachPlayerFormFromPlayer()) }} styles={styles} /> : null}
      {form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{detail ? 'Edit Player' : 'Add Player'}</Text>
          <Field label="Player name" onChangeText={(value) => setForm({ ...form, playerName: value })} styles={styles} value={form.playerName} />
          <Chips onChange={(value) => setForm({ ...form, section: value })} options={[{ label: 'Trial', value: 'Trial' }, { label: 'Squad', value: 'Squad' }]} styles={styles} value={form.section} />
          <Field label="Shirt number" onChangeText={(value) => setForm({ ...form, shirtNumber: value })} styles={styles} value={form.shirtNumber} />
          <Field label="Positions, separated by commas" onChangeText={(value) => setForm({ ...form, positions: value })} styles={styles} value={form.positions} />
          <Chips onChange={(value) => setForm({ ...form, contactType: value })} options={[{ label: 'Parent contact', value: 'parent' }, { label: 'Adult Player', value: 'self' }]} styles={styles} value={form.contactType} />
          <Field label="Contact name" onChangeText={(value) => setForm({ ...form, parentName: value, parentContacts: [{ email: form.parentContacts?.[0]?.email || '', name: value, type: form.contactType }] })} styles={styles} value={form.parentContacts?.[0]?.name || form.parentName} />
          <Field label="Contact email" onChangeText={(value) => setForm({ ...form, parentEmail: value, parentContacts: [{ email: value, name: form.parentContacts?.[0]?.name || '', type: form.contactType }] })} styles={styles} value={form.parentContacts?.[0]?.email || form.parentEmail} />
          <Field label="Private notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} />
          <Button disabled={saving} label={saving ? 'Saving...' : 'Save Player'} onPress={save} styles={styles} />
          <Button label="Cancel" onPress={() => setForm(null)} secondary styles={styles} />
        </View>
      ) : null}
      {detail && !form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{detail.player.playerName}</Text>
          <Text style={styles.meta}>{detail.player.section} | {detail.player.positions.join(', ') || 'No position'} | Shirt {detail.player.shirtNumber || 'not set'}</Text>
          {detail.player.parentContacts.map((contact) => <Text key={`${contact.email}:${contact.name}`} selectable style={styles.body}>{contact.type}: {contact.name || 'Unnamed'} | {contact.email || 'No email'}</Text>)}
          <Text style={styles.body}>{detail.player.notes || 'No private notes.'}</Text>
          <Text style={styles.cardTitle}>Custom fields</Text>
          <Text style={styles.body}>{detail.fields.map((field) => field.label).join(', ') || 'No enabled fields.'}</Text>
          <Text style={styles.cardTitle}>Session history</Text>
          {detail.sessions.length ? detail.sessions.map((session) => <Text key={session.id} style={styles.body}>{session.sessionDate} | {session.title} | {session.status}</Text>) : <Text style={styles.body}>No Session history.</Text>}
          {policy.canEdit ? <Button label="Edit Player" onPress={() => setForm(coachPlayerFormFromPlayer(detail.player))} styles={styles} /> : null}
          <View style={styles.filterRow}><Button label="Open Development" onPress={() => onNavigate('development')} secondary styles={styles} /><Button label="Open Resources" onPress={() => onNavigate('resources')} secondary styles={styles} /></View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Development</Text>
            {detail.evaluations.length ? <>
              <Text style={styles.meta}>{detail.evaluations.length} saved record{detail.evaluations.length === 1 ? '' : 's'}. Latest: {detail.evaluations[0]?.date || 'No date'} | Score {detail.evaluations[0]?.averageScore ?? 'not scored'}.</Text>
              <Button label={developmentOpen ? 'Hide recent records' : 'Show recent records'} onPress={() => setDevelopmentOpen((current) => !current)} secondary styles={styles} />
              {developmentOpen ? detail.evaluations.slice(0, 5).map((evaluation) => <Text key={evaluation.id} style={styles.body}>{evaluation.date || 'No date'} | {evaluation.session || 'Evaluation'} | Score {evaluation.averageScore ?? 'not scored'} | {evaluation.comments || 'No comments'}</Text>) : null}
              {developmentOpen && detail.evaluations.length > 5 ? <Text style={styles.meta}>Showing the 5 most recent records. Open Development for the full history.</Text> : null}
            </> : <Text style={styles.body}>No Development records.</Text>}
          </View>
          <Button label="Close" onPress={() => { setDetail(null); setDevelopmentOpen(false) }} secondary styles={styles} />
          <Text style={styles.meta}>Archive, restore, hard delete, and Team transfer remain in the governed web workflow.</Text>
        </View>
      ) : null}
      {!loading && visible.length === 0 ? <Text style={styles.body}>No active Players match this view.</Text> : null}
      {visible.map((player) => <Pressable accessibilityRole="button" key={player.id} onPress={() => openPlayer(player)} style={styles.card}><Text style={styles.cardTitle}>{player.playerName}</Text><Text style={styles.meta}>{player.section} | {player.positions.join(', ') || 'No position'} | Shirt {player.shirtNumber || 'not set'}</Text></Pressable>)}
    </View>
  )
}

export function CoachSessionsScreen({ context, onNavigate, onQuickActionHandled, palette, quickAction, user }) {
  const styles = useDomainStyles(palette)
  const [sessions, setSessions] = useState([])
  const [players, setPlayers] = useState([])
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('upcoming')
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stale, setStale] = useState(false)
  const [trainingEvents, setTrainingEvents] = useState([])
  const [trainingLocations, setTrainingLocations] = useState([])
  const [trainingForm, setTrainingForm] = useState(null)
  const [trainingNotice, setTrainingNotice] = useState('')
  const policy = getCoachSessionMutationPolicy({ context, session: detail?.session })
  const createTrainingForm = useCallback(() => ({
    ...coachCalendarFormFromEvent(null, context),
    eventType: 'training',
    notifyParents: true,
    parentAudience: 'all_team_parents',
    parentVisible: true,
    requestTrainingAvailability: true,
    trainingAvailabilitySendDaysBefore: 2,
    ...((trainingLocations[0] || '').trim() ? { location: trainingLocations[0] } : {}),
  }), [context, trainingLocations])
  const load = useCallback(async () => {
    setError(''); setLoading(true)
    const cached = await readCoachOfflineResources(user.id, context).catch(() => null)
    const hasCachedSessions = Array.isArray(cached?.resources?.sessions)
    if (hasCachedSessions) {
      setSessions(cached.resources.sessions)
      setPlayers(Array.isArray(cached.resources.sessionPlayers) ? cached.resources.sessionPlayers : [])
      setTrainingEvents(Array.isArray(cached.resources.trainingEvents) ? cached.resources.trainingEvents : [])
      setTrainingLocations(Array.isArray(cached.resources.trainingLocations) ? cached.resources.trainingLocations : [])
      setStale(true)
      setLoading(false)
    }
    try {
      const [sessionResult, playerResult, calendarResult] = await Promise.allSettled([
        withMobileAsyncTimeout(() => getCoachSessionList(user)),
        withMobileAsyncTimeout(() => getCoachPlayerList(user)),
        withMobileAsyncTimeout(() => getCoachCalendarResources(user)),
      ])
      if (sessionResult.status === 'rejected') throw sessionResult.reason
      const rows = sessionResult.value
      const playerRows = playerResult.status === 'fulfilled'
        ? playerResult.value
        : Array.isArray(cached?.resources?.sessionPlayers) ? cached.resources.sessionPlayers : []
      const calendarRows = calendarResult.status === 'fulfilled' ? calendarResult.value : []
      const nextTrainingEvents = filterCoachCalendarEvents(calendarRows, 'upcoming')
        .filter((event) => event.sourceType === 'calendar_event' && event.eventType === 'training')
      const nextTrainingLocations = calendarResult.status === 'fulfilled'
        ? getSavedLocationOptions(calendarRows)
        : Array.isArray(cached?.resources?.trainingLocations) ? cached.resources.trainingLocations : []
      setSessions(rows); setPlayers(playerRows); setTrainingEvents(nextTrainingEvents); setTrainingLocations(nextTrainingLocations); setStale(false)
      await saveCoachOfflineResources(user.id, context, { sessionPlayers: playerRows, sessions: rows, trainingEvents: nextTrainingEvents, trainingLocations: nextTrainingLocations })
    } catch (loadError) {
      if (!hasCachedSessions) setError(message(loadError, 'Sessions could not be loaded.'))
    } finally { setLoading(false) }
  }, [context, user])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (quickAction?.intent !== 'create-session') return
    setDetail(null)
    setForm(null)
    setTrainingForm(createTrainingForm())
    onQuickActionHandled?.()
  }, [createTrainingForm, onQuickActionHandled, quickAction])
  const visible = filterCoachSessions(sessions, filter)
  const openSession = async (session) => {
    setError('')
    try { setDetail(await getCoachSessionDetail(user, session.id)) }
    catch (detailError) { setError(message(detailError, 'Session details could not be loaded.')) }
  }
  const save = async () => {
    setSaving(true); setError('')
    try { await saveCoachSession(user, form, detail?.session || null); setForm(null); setDetail(null); await load() }
    catch (saveError) { setError(message(saveError, 'Session could not be saved.')) }
    finally { setSaving(false) }
  }
  const saveTraining = async () => {
    Keyboard.dismiss()
    setSaving(true); setError(''); setTrainingNotice('')
    try {
      const result = await saveCoachTrainingInvitation(user, trainingForm)
      setTrainingNotice(result.deliveryError || (result.requestTrainingAvailability
        ? 'Training session saved. Parents can now respond.'
        : 'Training session saved and shared with parents.'))
      setTrainingForm(null)
      await load()
    } catch (saveError) { setError(message(saveError, 'Training session could not be saved.')) }
    finally { setSaving(false) }
  }
  const complete = async () => {
    setSaving(true); setError('')
    try { await completeCoachSession(user, detail.session); setDetail(null); await load() }
    catch (completeError) { setError(message(completeError, 'Session could not be completed.')) }
    finally { setSaving(false) }
  }
  const addPlayer = async (player) => {
    setSaving(true); setError('')
    try { await addCoachSessionPlayers(user, detail.session, [player]); setDetail(await getCoachSessionDetail(user, detail.session.id)) }
    catch (addError) { setError(message(addError, 'Player could not be added to this Session.')) }
    finally { setSaving(false) }
  }
  const saveNotes = async (sessionPlayer, notes) => {
    setSaving(true); setError('')
    try { await updateCoachSessionPlayerNotes(user, detail.session, sessionPlayer.id, notes); setDetail(await getCoachSessionDetail(user, detail.session.id)) }
    catch (notesError) { setError(message(notesError, 'Player notes could not be saved.')) }
    finally { setSaving(false) }
  }
  return (
    <View style={styles.stack}>
      <DomainHeader copy="Create repeating training invitations for parents, or manage separate assessment Sessions and Player notes." styles={styles} title="Sessions" />
      <DomainState error={error} loading={loading} onRetry={load} stale={stale} styles={styles} />
      {trainingNotice ? <View style={styles.card}><Text style={styles.cardTitle}>{trainingNotice}</Text></View> : null}
      {policy.canCreate && !trainingForm && !form ? <Button label="Create training session" onPress={() => { setDetail(null); setTrainingForm(createTrainingForm()) }} styles={styles} /> : null}
      {trainingForm ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>Create training session</Text>
          <Field label="Title" onChangeText={(value) => setTrainingForm({ ...trainingForm, title: value })} styles={styles} value={trainingForm.title} />
          <CoachDateTimeField label="Date" mode="date" onChange={(value) => setTrainingForm({ ...trainingForm, date: value })} styles={styles} value={trainingForm.date} />
          <CoachDateTimeField label="Start time" mode="time" onChange={(value) => setTrainingForm({ ...trainingForm, startTime: value })} styles={styles} value={trainingForm.startTime} />
          <CoachDateTimeField label="End time" mode="time" onChange={(value) => setTrainingForm({ ...trainingForm, endTime: value })} styles={styles} value={trainingForm.endTime} />
          <LocationField locations={trainingLocations} onChange={(value) => setTrainingForm({ ...trainingForm, location: value })} styles={styles} value={trainingForm.location} />
          <Field label="Session notes" multiline onChangeText={(value) => setTrainingForm({ ...trainingForm, notes: value })} styles={styles} value={trainingForm.notes} />
          <Text style={styles.fieldLabel}>Repeat</Text>
          <Chips onChange={(value) => setTrainingForm({ ...trainingForm, recurrenceFrequency: value })} options={['none', 'weekly', 'fortnightly', 'monthly'].map((value) => ({ label: value, value }))} styles={styles} value={trainingForm.recurrenceFrequency} />
          {trainingForm.recurrenceFrequency !== 'none' ? <CoachDateTimeField label="Repeat until" mode="date" onChange={(value) => setTrainingForm({ ...trainingForm, recurrenceUntil: value })} styles={styles} value={trainingForm.recurrenceUntil} /> : null}
          <View style={styles.row}><Text style={styles.fieldLabel}>Notify parents now</Text><Switch accessibilityLabel="Notify parents now" onValueChange={(value) => setTrainingForm({ ...trainingForm, notifyParents: value, parentVisible: value || trainingForm.requestTrainingAvailability })} value={trainingForm.notifyParents} /></View>
          <Text style={styles.meta}>When enabled, the first invitation is sent as soon as you save.</Text>
          <View style={styles.row}><Text style={styles.fieldLabel}>Ask parents to respond</Text><Switch accessibilityLabel="Ask parents to respond" onValueChange={(value) => setTrainingForm({ ...trainingForm, notifyParents: value || trainingForm.notifyParents, parentVisible: value || trainingForm.notifyParents, requestTrainingAvailability: value })} value={trainingForm.requestTrainingAvailability} /></View>
          {trainingForm.requestTrainingAvailability ? <View style={styles.stack}><Text style={styles.fieldLabel}>Response reminder</Text><Chips onChange={(value) => setTrainingForm({ ...trainingForm, trainingAvailabilitySendDaysBefore: value })} options={[0, 1, 2, 3, 7].map((value) => ({ label: value === 0 ? 'No scheduled reminder' : `${value} ${value === 1 ? 'day' : 'days'} before`, value }))} styles={styles} value={trainingForm.trainingAvailabilitySendDaysBefore} /><Text style={styles.meta}>This is separate from the invitation sent now.</Text></View> : null}
          {(trainingForm.notifyParents || trainingForm.requestTrainingAvailability) ? <Chips onChange={(value) => setTrainingForm({ ...trainingForm, parentAudience: value })} options={[{ label: 'Team parents', value: 'all_team_parents' }, { label: 'Selected Players', value: 'involved_players' }]} styles={styles} value={trainingForm.parentAudience} /> : null}
          {(trainingForm.notifyParents || trainingForm.requestTrainingAvailability) && trainingForm.parentAudience === 'involved_players' ? <View style={styles.stack}><Text style={styles.fieldLabel}>Choose Players</Text>{players.map((player) => { const selectedPlayer = trainingForm.involvedPlayerIds.includes(player.id); return <Button key={player.id} label={`${selectedPlayer ? 'Remove' : 'Add'} ${player.playerName}`} onPress={() => setTrainingForm({ ...trainingForm, involvedPlayerIds: selectedPlayer ? trainingForm.involvedPlayerIds.filter((id) => id !== player.id) : [...trainingForm.involvedPlayerIds, player.id] })} secondary styles={styles} /> })}</View> : null}
          <Button disabled={saving || stale} label={saving ? 'Saving...' : 'Save training session'} onPress={saveTraining} styles={styles} />
          <Button label="Cancel" onPress={() => setTrainingForm(null)} secondary styles={styles} />
        </View>
      ) : null}
      {trainingEvents.length ? <View style={styles.card}><Text style={styles.cardTitle}>Upcoming training invitations</Text>{trainingEvents.slice(0, 8).map((event) => <Pressable accessibilityRole="button" key={event.id} onPress={() => onNavigate('calendar')} style={styles.stack}><Text style={styles.body}>{formatCoachCalendarEventDateTime(event)} | {event.title}</Text>{event.availabilitySummary ? <Text style={styles.meta}>Available {event.availabilitySummary.available} | Maybe {event.availabilitySummary.maybe} | Unavailable {event.availabilitySummary.unavailable} | Pending {event.availabilitySummary.pending}</Text> : null}</Pressable>)}</View> : null}
      <Text style={styles.cardTitle}>Assessment Sessions</Text>
      <Chips onChange={setFilter} options={[{ label: 'Upcoming', value: 'upcoming' }, { label: 'Completed', value: 'completed' }, { label: 'History', value: 'history' }, { label: 'All', value: 'all' }]} styles={styles} value={filter} />
      {getCoachSessionMutationPolicy({ context }).canCreate && !form && !trainingForm ? <Button label="Create assessment Session" onPress={() => { setDetail(null); setForm(coachSessionFormFromSession()) }} secondary styles={styles} /> : null}
      {form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{detail ? 'Edit Session' : 'Create Session'}</Text>
          <Chips onChange={(value) => setForm({ ...form, sessionType: value })} options={[{ label: 'Training', value: 'training' }, { label: 'Match', value: 'match' }]} styles={styles} value={form.sessionType} />
          <Field label="Title" onChangeText={(value) => setForm({ ...form, title: value })} styles={styles} value={form.title} />
          {form.sessionType === 'match' ? <Field label="Opponent" onChangeText={(value) => setForm({ ...form, opponent: value })} styles={styles} value={form.opponent} /> : null}
          <CoachDateTimeField label="Date" mode="date" onChange={(value) => setForm({ ...form, sessionDate: value })} outputFormat="iso" styles={styles} value={form.sessionDate} />
          <CoachDateTimeField label="Start time" mode="time" onChange={(value) => setForm({ ...form, startTime: value })} styles={styles} value={form.startTime} />
          <CoachDateTimeField label="End time" mode="time" onChange={(value) => setForm({ ...form, endTime: value })} styles={styles} value={form.endTime} />
          {form.sessionType === 'match' ? <CoachDateTimeField label="Arrival time" mode="time" onChange={(value) => setForm({ ...form, arrivalTime: value })} styles={styles} value={form.arrivalTime} /> : null}
          <LocationField locations={trainingLocations} onChange={(value) => setForm({ ...form, location: value })} styles={styles} value={form.location} />
          <Field label="Session notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} />
          <Button disabled={saving} label={saving ? 'Saving...' : 'Save Session'} onPress={save} styles={styles} />
          <Button label="Cancel" onPress={() => setForm(null)} secondary styles={styles} />
        </View>
      ) : null}
      {detail && !form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{detail.session.title}</Text>
          <Text style={styles.meta}>{detail.session.sessionDate} | {detail.session.startTime || 'Time not set'} | {detail.session.location || 'Location not set'} | {detail.session.status}</Text>
          <Text style={styles.body}>{detail.session.notes || 'No Session notes.'}</Text>
          <Text style={styles.cardTitle}>Session Players</Text>
          {detail.players.length ? detail.players.map((sessionPlayer) => <SessionPlayerNotes disabled={saving || !policy.canUpdatePlayerNotes} key={sessionPlayer.id} onSave={(notes) => saveNotes(sessionPlayer, notes)} sessionPlayer={sessionPlayer} styles={styles} />) : <Text style={styles.body}>No Players added yet.</Text>}
          {policy.canAddPlayers ? <><Text style={styles.cardTitle}>Add Players</Text>{players.filter((player) => !detail.players.some((row) => row.playerId === player.id)).map((player) => <Button disabled={saving} key={player.id} label={`Add ${player.playerName}`} onPress={() => addPlayer(player)} secondary styles={styles} />)}</> : null}
          {policy.canEdit ? <Button label="Edit Session" onPress={() => setForm(coachSessionFormFromSession(detail.session))} styles={styles} /> : null}
          {policy.canComplete ? <Button disabled={saving} label="Complete Session" onPress={complete} styles={styles} /> : null}
          <View style={styles.filterRow}><Button label="Open Players" onPress={() => onNavigate('players')} secondary styles={styles} /><Button label="Open Development" onPress={() => onNavigate('development')} secondary styles={styles} /></View>
          <Button label="Close" onPress={() => setDetail(null)} secondary styles={styles} />
          <Text style={styles.meta}>The authoritative model records inclusion and notes. It does not define separate present, absent, or late attendance states.</Text>
        </View>
      ) : null}
      {!loading && visible.length === 0 ? <Text style={styles.body}>No Sessions match this filter.</Text> : null}
      {visible.map((session) => <Pressable accessibilityRole="button" key={session.id} onPress={() => openSession(session)} style={styles.card}><Text style={styles.cardTitle}>{session.title}</Text><Text style={styles.meta}>{session.sessionDate} | {session.startTime || 'Time not set'} | {session.sessionType} | {session.status}</Text></Pressable>)}
    </View>
  )
}

function SessionPlayerNotes({ disabled, onSave, sessionPlayer, styles }) {
  const [notes, setNotes] = useState(sessionPlayer.notes)
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{sessionPlayer.playerName}</Text>
      <Field label={`Notes for ${sessionPlayer.playerName}`} multiline onChangeText={setNotes} styles={styles} value={notes} />
      <Button disabled={disabled} label="Save Player notes" onPress={() => onSave(notes)} secondary styles={styles} />
    </View>
  )
}
