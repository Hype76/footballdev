import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import {
  coachCalendarFormFromEvent,
  filterCoachCalendarEvents,
  formatCoachCalendarDateTime,
  getCoachCalendarMutationPolicy,
  groupCoachCalendarEvents,
} from '../../mobile-core/src/coachCalendarCore'
import { getCoachCalendarResources, saveCoachCalendarEvent } from '../../mobile-core/src/coachCalendarData'
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

function normalize(value) {
  return String(value ?? '').trim()
}

function message(error, fallback) {
  return normalize(error?.message) || fallback
}

function useDomainStyles(palette) {
  return useMemo(() => StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 12, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
    actionDisabled: { opacity: 0.45 },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900' },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 20 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 16, borderWidth: 1, gap: 8, padding: 14 },
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
    inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
    label: { color: palette.textMuted, fontSize: 12, fontWeight: '800' },
    meta: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 17 },
    row: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13, paddingVertical: 9 },
    secondaryText: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    stack: { gap: 12 },
    title: { color: palette.textPrimary, fontSize: 27, fontWeight: '900' },
    cardTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    warning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 14, borderWidth: 1, gap: 4, padding: 12 },
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

function DomainHeader({ copy, styles, title }) {
  return <View style={styles.stack}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.body}>{copy}</Text></View>
}

function DomainState({ error, loading, onRetry, stale, styles }) {
  if (loading) return <View style={styles.card}><ActivityIndicator /><Text style={styles.body}>Loading authoritative test data...</Text></View>
  if (error) return <View style={styles.warning}><Text style={styles.danger}>{error}</Text>{onRetry ? <Button label="Try again" onPress={onRetry} secondary styles={styles} /> : null}</View>
  if (stale) return <View style={styles.warning}><Text style={styles.cardTitle}>Offline read</Text><Text style={styles.body}>Showing encrypted data saved on this device. Changes require an online connection.</Text></View>
  return null
}

export function CoachCalendarScreen({ context, palette, user }) {
  const styles = useDomainStyles(palette)
  const [events, setEvents] = useState([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('upcoming')
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [players, setPlayers] = useState([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [stale, setStale] = useState(false)
  const policy = getCoachCalendarMutationPolicy({ context, event: selected })

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const [rows, playerRows] = await Promise.all([
        getCoachCalendarResources(user),
        user.activeTeamId ? getCoachPlayerList(user) : Promise.resolve([]),
      ])
      setEvents(rows)
      setPlayers(playerRows)
      setStale(false)
      await saveCoachOfflineResources(user.id, context.id, { calendar: rows, calendarPlayers: playerRows })
    } catch (loadError) {
      const cached = await readCoachOfflineResources(user.id, context.id).catch(() => null)
      if (cached?.resources?.calendar) {
        setEvents(cached.resources.calendar)
        setPlayers(cached.resources.calendarPlayers || [])
        setStale(true)
      } else setError(message(loadError, 'Calendar could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [context.id, user])

  useEffect(() => { void load() }, [load])
  const groups = groupCoachCalendarEvents(filterCoachCalendarEvents(events, filter))
  const openForm = (event = null) => {
    setSelected(event)
    setForm(coachCalendarFormFromEvent(event, context))
  }
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await saveCoachCalendarEvent(user, form, selected)
      setForm(null)
      setSelected(null)
      await load()
    } catch (saveError) {
      setError(message(saveError, 'Calendar event could not be saved.'))
    } finally { setSaving(false) }
  }

  return (
    <View style={styles.stack}>
      <DomainHeader copy="Calendar events, Match Day fixtures, Sessions, recurrence, and training availability in Europe/London time." styles={styles} title="Calendar" />
      <DomainState error={error} loading={loading} onRetry={load} stale={stale} styles={styles} />
      <Chips onChange={setFilter} options={[{ label: 'Upcoming', value: 'upcoming' }, { label: 'History', value: 'history' }, { label: 'Cancelled', value: 'cancelled' }, { label: 'All', value: 'all' }]} styles={styles} value={filter} />
      {policy.canCreate && !form ? <Button label="Create event" onPress={() => openForm()} styles={styles} /> : null}
      {form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{selected ? 'Edit event' : 'Create event'}</Text>
          <Field label="Title" onChangeText={(value) => setForm({ ...form, title: value })} styles={styles} value={form.title} />
          <Chips onChange={(value) => setForm({ ...form, eventType: value })} options={['general', 'training', 'match', 'meeting', 'tournament', 'social', 'other'].map((value) => ({ label: value, value }))} styles={styles} value={form.eventType} />
          <Field label="Date YYYY-MM-DD" onChangeText={(value) => setForm({ ...form, date: value })} styles={styles} value={form.date} />
          <Field label="Start time HH:MM" onChangeText={(value) => setForm({ ...form, startTime: value })} styles={styles} value={form.startTime} />
          <Field label="End time HH:MM" onChangeText={(value) => setForm({ ...form, endTime: value })} styles={styles} value={form.endTime} />
          <Field label="Location" onChangeText={(value) => setForm({ ...form, location: value })} styles={styles} value={form.location} />
          <Field label="Notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} />
          <Text style={styles.fieldLabel}>Repeat</Text>
          <Chips onChange={(value) => setForm({ ...form, recurrenceFrequency: value })} options={['none', 'weekly', 'fortnightly', 'monthly'].map((value) => ({ label: value, value }))} styles={styles} value={form.recurrenceFrequency} />
          {form.recurrenceFrequency !== 'none' ? <Field label="Repeat until YYYY-MM-DD" onChangeText={(value) => setForm({ ...form, recurrenceUntil: value })} styles={styles} value={form.recurrenceUntil} /> : null}
          <View style={styles.row}><Text style={styles.fieldLabel}>Visible to parents</Text><Switch accessibilityLabel="Visible to parents" onValueChange={(value) => setForm({ ...form, parentVisible: value })} value={form.parentVisible} /></View>
          {form.parentVisible ? <Chips onChange={(value) => setForm({ ...form, parentAudience: value })} options={[{ label: 'Involved Players', value: 'involved_players' }, { label: 'Team parents', value: 'all_team_parents' }, { label: 'Club parents', value: 'all_club_parents' }]} styles={styles} value={form.parentAudience} /> : null}
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
          <View style={styles.warning}><Text style={styles.body}>External communications and schedules are disabled in the test environment.</Text></View>
          <Button disabled={saving} label={saving ? 'Saving...' : 'Save event'} onPress={save} styles={styles} />
          <Button label="Cancel" onPress={() => { setForm(null); setSelected(null) }} secondary styles={styles} />
        </View>
      ) : null}
      {!loading && groups.length === 0 ? <Text style={styles.body}>No Calendar items match this filter.</Text> : null}
      {groups.map((group) => (
        <View key={group.date} style={styles.stack}>
          <Text style={styles.label}>{group.date}</Text>
          {group.events.map((event) => (
            <Pressable accessibilityRole="button" key={event.id} onPress={() => setSelected(selected?.id === event.id ? null : event)} style={styles.card}>
              <Text style={styles.cardTitle}>{event.title}</Text>
              <Text style={styles.meta}>{formatCoachCalendarDateTime(event.startsAt)} | {event.eventType} | {event.teamName || 'Club-wide'}</Text>
              {event.location ? <Text style={styles.body}>{event.location}</Text> : null}
              {event.availabilitySummary ? <Text style={styles.meta}>Available {event.availabilitySummary.available} | Maybe {event.availabilitySummary.maybe} | Unavailable {event.availabilitySummary.unavailable} | Pending {event.availabilitySummary.pending}</Text> : null}
              {selected?.id === event.id ? <><Text style={styles.body}>{event.notes || 'No notes.'}</Text>{getCoachCalendarMutationPolicy({ context, event }).canEdit ? <Button label="Edit event" onPress={() => openForm(event)} secondary styles={styles} /> : <Text style={styles.meta}>Edit this item in its authoritative {event.sourceType === 'match_day' ? 'Match Day' : event.sourceType === 'assessment_session' ? 'Session' : 'web'} workflow.</Text>}</> : null}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  )
}

export function CoachPlayersScreen({ context, palette, user }) {
  const styles = useDomainStyles(palette)
  const [players, setPlayers] = useState([])
  const [detail, setDetail] = useState(null)
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
    try {
      const rows = await getCoachPlayerList(user)
      setPlayers(rows); setStale(false)
      await saveCoachOfflineResources(user.id, context.id, { players: rows })
    } catch (loadError) {
      const cached = await readCoachOfflineResources(user.id, context.id).catch(() => null)
      if (cached?.resources?.players) { setPlayers(cached.resources.players); setStale(true) }
      else setError(message(loadError, 'Players could not be loaded.'))
    } finally { setLoading(false) }
  }, [context.id, user])
  useEffect(() => { void load() }, [load])
  const visible = filterCoachPlayers(players, { query, section, status: 'active' })
  const openPlayer = async (player) => {
    setError('')
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
          <Text style={styles.cardTitle}>Development</Text>
          {detail.evaluations.length ? detail.evaluations.map((evaluation) => <Text key={evaluation.id} style={styles.body}>{evaluation.date || 'No date'} | {evaluation.session || 'Evaluation'} | Score {evaluation.averageScore ?? 'not scored'} | {evaluation.comments || 'No comments'}</Text>) : <Text style={styles.body}>No Development records.</Text>}
          <Text style={styles.cardTitle}>Custom fields</Text>
          <Text style={styles.body}>{detail.fields.map((field) => field.label).join(', ') || 'No enabled fields.'}</Text>
          <Text style={styles.cardTitle}>Session history</Text>
          {detail.sessions.length ? detail.sessions.map((session) => <Text key={session.id} style={styles.body}>{session.sessionDate} | {session.title} | {session.status}</Text>) : <Text style={styles.body}>No Session history.</Text>}
          {policy.canEdit ? <Button label="Edit Player" onPress={() => setForm(coachPlayerFormFromPlayer(detail.player))} styles={styles} /> : null}
          <Button label="Close" onPress={() => setDetail(null)} secondary styles={styles} />
          <Text style={styles.meta}>Archive, restore, hard delete, and Team transfer remain in the governed web workflow.</Text>
        </View>
      ) : null}
      {!loading && visible.length === 0 ? <Text style={styles.body}>No active Players match this view.</Text> : null}
      {visible.map((player) => <Pressable accessibilityRole="button" key={player.id} onPress={() => openPlayer(player)} style={styles.card}><Text style={styles.cardTitle}>{player.playerName}</Text><Text style={styles.meta}>{player.section} | {player.positions.join(', ') || 'No position'} | Shirt {player.shirtNumber || 'not set'}</Text></Pressable>)}
    </View>
  )
}

export function CoachSessionsScreen({ context, palette, user }) {
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
  const policy = getCoachSessionMutationPolicy({ context, session: detail?.session })
  const load = useCallback(async () => {
    setError(''); setLoading(true)
    try {
      const [rows, playerRows] = await Promise.all([getCoachSessionList(user), getCoachPlayerList(user)])
      setSessions(rows); setPlayers(playerRows); setStale(false)
      await saveCoachOfflineResources(user.id, context.id, { sessionPlayers: playerRows, sessions: rows })
    } catch (loadError) {
      const cached = await readCoachOfflineResources(user.id, context.id).catch(() => null)
      if (cached?.resources?.sessions) { setSessions(cached.resources.sessions); setPlayers(cached.resources.sessionPlayers || []); setStale(true) }
      else setError(message(loadError, 'Sessions could not be loaded.'))
    } finally { setLoading(false) }
  }, [context.id, user])
  useEffect(() => { void load() }, [load])
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
      <DomainHeader copy="Assessment Sessions with canonical Team roster inclusion, Player notes, Development links, and completion." styles={styles} title="Sessions" />
      <DomainState error={error} loading={loading} onRetry={load} stale={stale} styles={styles} />
      <Chips onChange={setFilter} options={[{ label: 'Upcoming', value: 'upcoming' }, { label: 'Completed', value: 'completed' }, { label: 'History', value: 'history' }, { label: 'All', value: 'all' }]} styles={styles} value={filter} />
      {getCoachSessionMutationPolicy({ context }).canCreate && !form ? <Button label="Create Session" onPress={() => { setDetail(null); setForm(coachSessionFormFromSession()) }} styles={styles} /> : null}
      {form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{detail ? 'Edit Session' : 'Create Session'}</Text>
          <Chips onChange={(value) => setForm({ ...form, sessionType: value })} options={[{ label: 'Training', value: 'training' }, { label: 'Match', value: 'match' }]} styles={styles} value={form.sessionType} />
          <Field label="Title" onChangeText={(value) => setForm({ ...form, title: value })} styles={styles} value={form.title} />
          {form.sessionType === 'match' ? <Field label="Opponent" onChangeText={(value) => setForm({ ...form, opponent: value })} styles={styles} value={form.opponent} /> : null}
          <Field label="Date YYYY-MM-DD" onChangeText={(value) => setForm({ ...form, sessionDate: value })} styles={styles} value={form.sessionDate} />
          <Field label="Start time HH:MM" onChangeText={(value) => setForm({ ...form, startTime: value })} styles={styles} value={form.startTime} />
          <Field label="End time HH:MM" onChangeText={(value) => setForm({ ...form, endTime: value })} styles={styles} value={form.endTime} />
          {form.sessionType === 'match' ? <Field label="Arrival time HH:MM" onChangeText={(value) => setForm({ ...form, arrivalTime: value })} styles={styles} value={form.arrivalTime} /> : null}
          <Field label="Location" onChangeText={(value) => setForm({ ...form, location: value })} styles={styles} value={form.location} />
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
