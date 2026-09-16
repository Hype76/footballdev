import { openVenueDirections } from '../../mobile-core/src/venueDirections'
import { canEditCoachFixture } from '../../mobile-core/src/coachFixtureEditCore'
import { formatUkDate } from '../../../src/lib/date-format.js'
import { VenueMapPreview } from '../../mobile-core/src/VenueMapPreview'
import { PinnedEventNotes } from '../../mobile-core/src/PinnedEventNotes'
import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invalidateMobileResource, peekMobileResource, readMobileResource } from '../../mobile-core/src/mobileResourceCache'
import { Alert, Keyboard, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import {
  buildCoachCalendarMonth,
  coachCalendarFormFromEvent,
  filterCoachCalendarEvents,
  formatCoachCalendarEventDateTime,
  getCoachCalendarContextModel,
  getCoachCalendarMonthKey,
  getCoachCalendarMutationPolicy,
  getCoachCalendarEventResourceIds,
  groupCoachCalendarEvents,
  formatCoachCalendarFormDate,
  shiftCoachCalendarMonth,
  toggleCoachCalendarResourceId,
} from '../../mobile-core/src/coachCalendarCore'
import {
  cancelCoachCalendarEvent,
  commitCoachCalendarChangeNotification,
  deleteCoachCalendarEvent,
  getCoachCalendarResources,
  prepareCoachCalendarChangeNotification,
  saveCoachCalendarEvent,
  saveCoachTrainingInvitation,
  syncCoachCalendarEventResources,
} from '../../mobile-core/src/coachCalendarData'
import { getCoachTeamNotificationDisplayName } from '../../mobile-core/src/coachTeamNotificationData'
import { deriveTeamNotificationDisplayName } from '../../../src/lib/team-notification-display.js'
import { getMatchDayShirtChoiceLabel } from '../../../src/lib/matchday-model.js'
import { getCoachResourceAccessUrl, getCoachResources } from '../../mobile-core/src/coachPhase31EData'
import {
  coachPlayerFormFromPlayer,
  filterCoachPlayers,
  formatCoachParentAppInstallationStatus,
  getCoachPlayerMutationPolicy,
} from '../../mobile-core/src/coachPlayersCore'
import { getCoachPlayerDetail, getCoachPlayerList, saveCoachPlayer } from '../../mobile-core/src/coachPlayersData'
import { getCoachParentLinks, revokeCoachParentAccess, sendCoachParentInvite } from '../../mobile-core/src/coachParentContactsData'
import { getParentPortalInviteActionForContact, getUnlistedParentAccessLinks } from '../../../src/lib/parent-portal-invite-actions.js'
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
import { createCoachOfflineResourceSaver, readCoachOfflineResources, saveCoachOfflineResources } from './offline'
import { getCoachOfflineSaveWarning } from './coachOfflineErrors'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import { CoachDateTimeField } from './CoachDateTimeField'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { useConfirmedConnectionIssue, useConfirmedConnectionMessage } from '../../mobile-core/src/useConfirmedConnectionIssue'
import { getMobileIconName } from '../../mobile-core/src/mobileIconSystem'

const message = getCoachFriendlyError

function useDomainStyles(palette) {
  return useMemo(() => StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderColor: palette.accentText, borderWidth: 1, borderRadius: 12, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
    actionDisabled: { opacity: 0.45 },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900' },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 20 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 16, borderWidth: 1, gap: 8, padding: 14 },
    calendar: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 16, borderWidth: 1, gap: 10, padding: 10 },
    calendarDay: { alignItems: 'center', borderColor: 'transparent', borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 52, paddingVertical: 5 },
    calendarDayOutside: { backgroundColor: palette.background, borderColor: palette.border, borderStyle: 'dashed' },
    calendarDaySelected: { backgroundColor: palette.selected, borderColor: palette.accentText, borderStyle: 'solid' },
    calendarDayToday: { borderColor: palette.accentText },
    calendarDayText: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    calendarDayTextSelected: { color: palette.selectedForeground },
    calendarEventCount: { color: palette.accentText, fontSize: 10, fontWeight: '900', minHeight: 13 },
    calendarHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    calendarMonth: { color: palette.textPrimary, flex: 1, fontSize: 17, fontWeight: '900', textAlign: 'center' },
    calendarNav: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 40, minWidth: 74, paddingHorizontal: 8 },
    calendarNavText: { color: palette.textPrimary, fontSize: 12, fontWeight: '900' },
    calendarWeek: { flexDirection: 'row', gap: 4 },
    calendarWeekday: { color: palette.textMuted, flex: 1, fontSize: 10, fontWeight: '900', textAlign: 'center' },
    chip: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 13 },
    chipActive: { backgroundColor: palette.selected, borderColor: palette.accentText },
    chipText: { color: palette.textSecondary, fontSize: 12, fontWeight: '800' },
    chipTextActive: { color: palette.selectedForeground },
    danger: { color: palette.danger, fontSize: 13, fontWeight: '800', lineHeight: 19 },
    field: { gap: 5 },
    fieldLabel: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    form: { backgroundColor: palette.surface, borderColor: palette.accentText, borderRadius: 16, borderWidth: 1, gap: 12, padding: 14 },
    input: { backgroundColor: palette.background, borderColor: palette.border, borderRadius: 12, borderWidth: 1, color: palette.textPrimary, fontSize: 15, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
    inputText: { color: palette.textPrimary, fontSize: 15 },
    inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
    label: { color: palette.textMuted, fontSize: 12, fontWeight: '800' },
    meta: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 17 },
    pickerActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
    pickerButton: { alignItems: 'center', borderColor: palette.border, borderRadius: 10, borderWidth: 1, minHeight: 42, justifyContent: 'center', minWidth: 88, paddingHorizontal: 12 },
    pickerButtonText: { color: palette.accentText, fontSize: 14, fontWeight: '900' },
    pickerPanel: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, gap: 8, overflow: 'hidden', padding: 8 },
    profileAction: { alignItems: 'center', flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 44, minWidth: 44, paddingHorizontal: 6, paddingVertical: 7 },
    profileActionText: { color: palette.accentText, fontSize: 12, fontWeight: '900' },
    profileHeader: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingBottom: 12 },
    profileIdentity: { alignItems: 'center', backgroundColor: palette.selected, borderRadius: 999, height: 42, justifyContent: 'center', width: 42 },
    profileRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 62, paddingVertical: 10 },
    profileSection: { borderBottomColor: palette.border, borderBottomWidth: 1, gap: 10, paddingBottom: 12 },
    profileSectionButton: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', minHeight: 44 },
    profileSectionTitle: { color: palette.textPrimary, flexShrink: 1, fontSize: 16, fontWeight: '900' },
    profileStat: { alignItems: 'center', flex: 1, gap: 2, minWidth: 88, paddingVertical: 4 },
    playerCard: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 72, paddingHorizontal: 2, paddingVertical: 10 },
    playerCopy: { flex: 1, gap: 3, minWidth: 0 },
    readiness: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    readinessDot: { borderRadius: 999, borderWidth: 1, height: 10, width: 10 },
    readinessDotOff: { backgroundColor: palette.textMuted, borderColor: palette.textMuted, opacity: 0.55 },
    readinessDotOn: { backgroundColor: palette.success, borderColor: palette.success },
    readinessDots: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
    row: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13, paddingVertical: 9 },
    secondaryText: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    stack: { gap: 12 },
    title: { color: palette.textPrimary, fontSize: 27, fontWeight: '900' },
    cardTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    warning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 14, borderWidth: 1, gap: 4, padding: 12 },
    warningText: { color: palette.warning, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  }), [palette])
}

function Button({ disabled = false, iconKey = '', label, onPress, secondary = false, styles }) {
  const contentStyle = secondary ? styles.secondaryText : styles.actionText
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [secondary ? styles.secondary : styles.action, disabled && styles.actionDisabled, pressed && { opacity: 0.75 }]}
    >
      {iconKey ? <MaterialIcons name={getMobileIconName(iconKey)} size={21} style={contentStyle} /> : null}
      <Text style={contentStyle}>{label}</Text>
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

function ParentAppInstallationStatus({ player, styles }) {
  if (player.parentAppInstallationStatusAvailable !== true) return null
  const contactCount = Number(player.parentAppContactCount || 0)
  const installedCount = Math.min(contactCount, Number(player.parentAppInstalledContactCount || 0))
  const label = formatCoachParentAppInstallationStatus({
    available: true,
    contactCount,
    installedCount,
  })
  return (
    <View accessibilityLabel={label} accessibilityRole="text" style={styles.readiness}>
      {contactCount > 0 ? (
        <View style={styles.readinessDots}>
          {Array.from({ length: contactCount }, (_, index) => (
            <View
              key={`${player.id}:parent-app:${index}`}
              style={[styles.readinessDot, index < installedCount ? styles.readinessDotOn : styles.readinessDotOff]}
            />
          ))}
        </View>
      ) : null}
      <Text style={styles.meta}>{label}</Text>
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
  const confirmedStale = useConfirmedConnectionIssue(stale)
  const visibleError = useConfirmedConnectionMessage(error)
  if (loading) return <View style={styles.card}><BrandLoader /><Text style={styles.body}>Loading...</Text></View>
  if (error && !visibleError) return <View style={styles.card}><BrandLoader /><Text style={styles.body}>Checking for the latest information...</Text></View>
  if (visibleError) return <View style={styles.warning}><Text style={styles.danger}>{visibleError}</Text>{onRetry ? <Button label="Try again" onPress={onRetry} secondary styles={styles} /> : null}</View>
  if (confirmedStale) return <View style={styles.warning}><Text style={styles.cardTitle}>You are offline</Text><Text style={styles.body}>Showing saved information. Connect before making changes.</Text></View>
  return null
}

function formatResourceCategory(value) {
  return String(value || 'general').trim().replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function CoachCalendarScreen({ calendarTarget, context, contexts, onNavigate, onQuickActionHandled, onSelectContext, palette, quickAction, user }) {
  const styles = useDomainStyles(palette)
  const [resourceEditor, setResourceEditor] = useState(null)
  const [resourceQuery, setResourceQuery] = useState('')
  const [resourceCategory, setResourceCategory] = useState('all')
  const [resourceError, setResourceError] = useState('')
  const resourceRequest = useRef(0)
  const [attachmentCategory, setAttachmentCategory] = useState('all')
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false)
  const [events, setEvents] = useState([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('upcoming')
  const [form, setForm] = useState(null)
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(true)
  const [players, setPlayers] = useState([])
  const [resources, setResources] = useState([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [focusedEventId, setFocusedEventId] = useState('')
  const handledTarget = useRef(null)
  const [saveConfirmation, setSaveConfirmation] = useState('')
  const [stale, setStale] = useState(false)
  const [teamNotificationName, setTeamNotificationName] = useState(
    () => deriveTeamNotificationDisplayName(user.activeTeamName || context?.teamName || ''),
  )
  const [visibleMonth, setVisibleMonth] = useState(() => getCoachCalendarMonthKey())
  const contextModel = getCoachCalendarContextModel({ context, contexts })
  const policy = getCoachCalendarMutationPolicy({ context, event: selected })

  const load = useCallback(async ({ reuseFresh = false } = {}) => {
    setError('')
    const recent = reuseFresh ? peekMobileResource(user, 'coach:calendar') : undefined
    if (recent !== undefined) {
      setEvents(recent); setLoading(false); setStale(false)
    }
    else setLoading(true)
    const cached = recent !== undefined ? null : await readCoachOfflineResources(user.id, context).catch(() => null)
    const hasCachedCalendar = Array.isArray(cached?.resources?.calendar)
    if (hasCachedCalendar) {
      setEvents(cached.resources.calendar)
      setPlayers(Array.isArray(cached.resources.calendarPlayers) ? cached.resources.calendarPlayers : [])
      setResources(Array.isArray(cached.resources.calendarResourceOptions) ? cached.resources.calendarResourceOptions : [])
      setStale(true)
      setLoading(false)
    }
    try {
      const options = { force: !reuseFresh }
      const optionalResults = Promise.allSettled([
        user.activeTeamId ? readMobileResource(user, 'coach:players', () => getCoachPlayerList(user), options) : Promise.resolve([]),
        user.activeTeamId ? readMobileResource(user, 'coach:phase31e:resources', () => getCoachResources(user), options) : Promise.resolve([]),
      ])
      const rows = await readMobileResource(user, 'coach:calendar', () => getCoachCalendarResources(user), options)
      setEvents(rows)
      setLoading(false)
      setStale(false)
      const [playerResult, resourceResult] = await optionalResults
      const playerRows = playerResult.status === 'fulfilled' ? playerResult.value : cached?.resources?.calendarPlayers || []
      const resourceRows = resourceResult.status === 'fulfilled' ? resourceResult.value : cached?.resources?.calendarResourceOptions || []
      setPlayers(playerRows)
      setResources(resourceRows)
      if (user.activeTeamId) {
        const savedTeamNotificationName = await getCoachTeamNotificationDisplayName(user).catch(() => (
          deriveTeamNotificationDisplayName(user.activeTeamName || context?.teamName || '')
        ))
        setTeamNotificationName(savedTeamNotificationName)
      }
      setStale(false)
      await saveCoachOfflineResources(user.id, context, { calendar: rows, calendarPlayers: playerRows, calendarResourceOptions: resourceRows })
    } catch (loadError) {
      if (!hasCachedCalendar) setError(message(loadError, 'Calendar could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [context, user])

  useEffect(() => { void load({ reuseFresh: true }) }, [load])
  const calendarMonth = useMemo(
    () => buildCoachCalendarMonth(events, visibleMonth, selectedDate),
    [events, selectedDate, visibleMonth],
  )
  const selectedDay = calendarMonth.days.find((day) => day.date === selectedDate)
  const savedLocations = useMemo(() => getSavedLocationOptions(events), [events])
  const attachmentCategories = useMemo(() => [...new Set(resources.map((resource) => String(resource.category || 'general').trim().toLowerCase()).filter(Boolean))].sort(), [resources])
  const visibleEvents = focusedEventId ? events.filter(event => event.id === focusedEventId) : selectedDate
    ? events.filter((event) => event.calendarDate === selectedDate)
    : filterCoachCalendarEvents(events, filter)
  const groups = groupCoachCalendarEvents(visibleEvents)
  useEffect(() => {
    if (!calendarTarget || handledTarget.current === calendarTarget) return
    const event = events.find(item => (calendarTarget.eventId ? item.id === calendarTarget.eventId : item.sourceId === calendarTarget.sourceId)
      && (!calendarTarget.sourceType || item.sourceType === calendarTarget.sourceType)
      && (!calendarTarget.occurrenceDate || (item.occurrenceDate || item.calendarDate) === calendarTarget.occurrenceDate))
    if (!event) return
    handledTarget.current = calendarTarget
    setSelected(event)
    setFocusedEventId(event.id)
    setSelectedDate(event.calendarDate)
    setVisibleMonth(event.calendarDate.slice(0, 7))
    setForm(null)
  }, [calendarTarget, events])

  const openForm = (event = null) => {
    setFormError('')
    setSaveConfirmation('')
    setSelected(event)
    setAttachmentCategory('all')
    setAttachmentPickerOpen(false)
    const nextForm = coachCalendarFormFromEvent(event
      ? { ...event, resourceIds: getCoachCalendarEventResourceIds(resources, event.sourceId, event.occurrenceDate || event.calendarDate, event.sourceType) }
      : null, context)
    setForm({
      ...nextForm,
      notificationTeamName: nextForm.notificationTeamName || teamNotificationName,
      ...(!event && selectedDate ? { date: formatCoachCalendarFormDate(selectedDate) } : {}),
      ...(!event && !nextForm.location && savedLocations[0] ? { location: savedLocations[0] } : {}),
    })
  }
  useEffect(() => {
    if (quickAction?.route !== 'calendar') return
    setFocusedEventId('')
    setSelected(null)
    setFormError('')
    setSaveConfirmation('')
    setAttachmentCategory('all')
    setAttachmentPickerOpen(false)
    const nextForm = coachCalendarFormFromEvent(null, context)
    setForm({
      ...nextForm,
      notificationTeamName: nextForm.notificationTeamName || teamNotificationName,
      ...(!nextForm.location && savedLocations[0] ? { location: savedLocations[0] } : {}),
    })
    onQuickActionHandled?.()
  }, [context, onQuickActionHandled, quickAction, savedLocations, teamNotificationName])
  const chooseNotification = (actionLabel, itemTitle) => new Promise((resolve) => {
    Alert.alert(
      `Notify everyone about this ${actionLabel}?`,
      `${itemTitle || 'This Calendar item'} will be ${actionLabel}. Would you like to notify everyone involved?`,
      [
        { onPress: () => resolve(null), style: 'cancel', text: 'Go back' },
        { onPress: () => resolve(false), text: `Do not notify` },
        { onPress: () => resolve(true), text: 'Notify everyone' },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    )
  })
  const save = async () => {
    Keyboard.dismiss()
    setSaving(true)
    setError('')
    setFormError('')
    setSaveConfirmation('')
    try {
      const original = selected ? coachCalendarFormFromEvent(selected, context) : null
      const isRescheduled = Boolean(original && (
        original.date !== form?.date
        || original.startTime !== form?.startTime
        || original.endTime !== form?.endTime
      ))
      const notifyEveryone = isRescheduled ? await chooseNotification('rescheduled', selected?.title) : false
      if (isRescheduled && notifyEveryone === null) return
      const preparation = notifyEveryone ? await prepareCoachCalendarChangeNotification(selected, 'rescheduled') : null
      const attachmentOccurrenceDate = selected?.occurrenceDate || selected?.calendarDate || form?.date
      const savedEvent = await saveCoachCalendarEvent(user, form, selected)
      let attachmentMessage = ''
      if (savedEvent.teamId && Number(user.roleRank || 0) >= 50) {
        try {
          await syncCoachCalendarEventResources(user, savedEvent, form?.resourceIds || [], attachmentOccurrenceDate)
        } catch (attachmentError) {
          attachmentMessage = ` The event was saved, but its Resources could not be updated: ${message(attachmentError, 'edit the event and try again.')}`
        }
      }
      let notificationMessage = ''
      if (preparation?.preparationId) {
        try {
          const delivery = await commitCoachCalendarChangeNotification(preparation.preparationId)
          notificationMessage = ` ${delivery.recipientCount || 0} involved contact${delivery.recipientCount === 1 ? '' : 's'} notified.`
        } catch (notificationError) {
          notificationMessage = ` The change was saved, but notifications could not be completed: ${message(notificationError, 'try again from the web Calendar.')}`
        }
      }
      setSaveConfirmation(`${form?.eventType === 'match' ? 'Match saved.' : 'Event saved.'}${attachmentMessage}${notificationMessage}`)
      setForm(null)
      setSelected(null)
      await load()
    } catch (saveError) {
      setFormError(message(saveError, 'Calendar event could not be saved.'))
    } finally { setSaving(false) }
  }
  const openEventResource = async (resource) => {
    try {
      const accessUrl = await getCoachResourceAccessUrl(user, resource)
      if (!await Linking.canOpenURL(accessUrl)) throw new Error('This Resource link is not supported on this device.')
      await Linking.openURL(accessUrl)
    } catch (resourceError) {
      setError(message(resourceError, 'This Resource could not be opened.'))
    }
  }
  const canAddEventResource = (event) => !stale && !user.isOfflineProfile
    && Number(user.roleRank || 0) >= 50 && Number(context?.roleRank || 0) >= 50
    && context?.paymentAccess?.canMutate === true
    && (event?.sourceType !== 'calendar_event' || getCoachCalendarMutationPolicy({ context, event }).canEdit)
    && ['calendar_event', 'match_day', 'assessment_session'].includes(event?.sourceType) && event?.teamId === user.activeTeamId
    && Boolean(event?.teamId) && !['cancelled', 'deleted'].includes(event?.status)

  useEffect(() => () => { resourceRequest.current += 1 }, [user])

  const openResourceEditor = async (event) => {
    if (!canAddEventResource(event) || saving) return
    const request = ++resourceRequest.current
    setResourceQuery('')
    setResourceCategory('all')
    setResourceError('')
    setResourceEditor({ event, loading: true, selectedIds: [], attachedIds: [], options: [] })
    try {
      const options = await getCoachResources(user)
      if (request !== resourceRequest.current) return
      const attachedIds = getCoachCalendarEventResourceIds(options, event.sourceId, event.occurrenceDate || event.calendarDate, event.sourceType)
      setResources(options)
      setResourceEditor({ event, loading: false, selectedIds: [], attachedIds, options })
    } catch (loadError) {
      if (request !== resourceRequest.current) return
      setResourceError(message(loadError, 'Resources could not be loaded. Try again.'))
      setResourceEditor({ event, loading: false, failed: true, selectedIds: [], attachedIds: [], options: [] })
    }
  }
  const saveEventResources = async () => {
    if (!resourceEditor || resourceEditor.loading || resourceEditor.failed || saving || !canAddEventResource(resourceEditor.event)) return
    setSaving(true)
    setResourceError('')
    try {
      const event = resourceEditor.event
      // Refresh the existing links so adding a Resource preserves current attachments.
      const latest = await getCoachResources(user)
      const attachedIds = getCoachCalendarEventResourceIds(latest, event.sourceId, event.occurrenceDate || event.calendarDate, event.sourceType)
      await syncCoachCalendarEventResources(user, event, [...new Set([...attachedIds, ...resourceEditor.selectedIds])], event.occurrenceDate || event.calendarDate)
      invalidateMobileResource(user, 'coach:phase31e:resources')
      setResourceEditor(null)
      setSaveConfirmation('Resources added to this event.')
      await load()
    } catch (saveError) {
      setResourceError(message(saveError, 'Resources could not be added. Try again.'))
    } finally { setSaving(false) }
  }
  const changeEventState = async (changeAction) => {
    if (!selected) return
    const actionLabel = changeAction === 'cancelled' ? 'cancelled' : 'deleted'
    const notifyEveryone = await chooseNotification(actionLabel, selected.title)
    if (notifyEveryone === null) return
    setSaving(true)
    setError('')
    setSaveConfirmation('')
    try {
      const preparation = notifyEveryone ? await prepareCoachCalendarChangeNotification(selected, changeAction) : null
      if (changeAction === 'cancelled') await cancelCoachCalendarEvent(user, selected)
      else await deleteCoachCalendarEvent(user, selected)
      let notificationMessage = ''
      if (preparation?.preparationId) {
        try {
          const delivery = await commitCoachCalendarChangeNotification(preparation.preparationId)
          notificationMessage = ` ${delivery.recipientCount || 0} involved contact${delivery.recipientCount === 1 ? '' : 's'} notified.`
        } catch (notificationError) {
          notificationMessage = ` The change was saved, but notifications could not be completed: ${message(notificationError, 'try again from the web Calendar.')}`
        }
      }
      setSelected(null)
      setSaveConfirmation(`Event ${actionLabel}.${notificationMessage}`)
      await load()
    } catch (changeError) {
      setError(message(changeError, `Calendar event could not be ${actionLabel}.`))
    } finally {
      setSaving(false)
    }
  }

  if (resourceEditor) {
    const options = resourceEditor.options.filter((resource) => (
      (resourceCategory === 'all' || String(resource.category || 'general').trim().toLowerCase() === resourceCategory)
      && `${resource.title || ''} ${resource.description || ''}`.toLowerCase().includes(resourceQuery.trim().toLowerCase())
    ))
    const categories = [...new Set(resourceEditor.options.map((resource) => String(resource.category || 'general').trim().toLowerCase()))].sort()
    return (
      <View style={styles.stack}>
        <Button disabled={saving} label="Back to event" onPress={() => { resourceRequest.current += 1; setResourceEditor(null) }} secondary styles={styles} />
        <DomainHeader copy={`${resourceEditor.event.title} | ${formatUkDate(resourceEditor.event.occurrenceDate || resourceEditor.event.calendarDate)}`} styles={styles} title="Add resource" />
        {resourceEditor.loading ? <Text style={styles.body}>Loading Resources...</Text> : null}
        {resourceError ? <View accessibilityRole="alert" style={styles.warning}><Text style={styles.danger}>{resourceError}</Text></View> : null}
        {resourceEditor.failed ? <Button label="Retry Resources" onPress={() => void openResourceEditor(resourceEditor.event)} secondary styles={styles} /> : null}
        {!resourceEditor.loading && !resourceEditor.failed ? <>
          <Text style={styles.body}>Choose Resources for this event. Existing attachments will stay attached.</Text>
          <TextInput accessibilityLabel="Search event Resources" placeholder="Search Resources" placeholderTextColor={palette.textMuted} onChangeText={setResourceQuery} style={styles.input} value={resourceQuery} />
          <Chips onChange={setResourceCategory} options={[{ label: 'All categories', value: 'all' }, ...categories.map((value) => ({ label: value.replaceAll('_', ' '), value }))]} styles={styles} value={resourceCategory} />
          {options.map((resource) => {
            const attached = resourceEditor.attachedIds.includes(resource.id)
            const checked = resourceEditor.selectedIds.includes(resource.id)
            return <Button key={resource.id} disabled={attached || saving} label={`${attached ? 'Attached' : checked ? 'Selected' : 'Add'} ${resource.title}`} onPress={() => setResourceEditor((current) => ({ ...current, selectedIds: toggleCoachCalendarResourceId(current.selectedIds, resource.id) }))} secondary={!checked} styles={styles} />
          })}
          {!options.length ? <Text style={styles.body}>{resourceEditor.options.length ? 'No Resources match this search.' : 'No active Team Resources are available.'}</Text> : null}
          <Button disabled={saving || stale || !resourceEditor.selectedIds.length} label={saving ? 'Saving Resources...' : `Add selected Resources (${resourceEditor.selectedIds.length})`} onPress={() => void saveEventResources()} styles={styles} />
        </> : null}
      </View>
    )
  }

  return (
    <View style={styles.stack}>
      <DomainHeader copy="Calendar events, Match Day fixtures, Sessions, recurrence, and training availability in Europe/London time." styles={styles} title="Calendar" />
      {focusedEventId ? <Button label="Back to Calendar" onPress={() => { setFocusedEventId(''); setSelected(null) }} secondary styles={styles} /> : null}
      {!focusedEventId ? <><View accessibilityLabel={`${calendarMonth.title} Calendar`} style={styles.calendar}>
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
      </View></> : null}
      <DomainState error={error} loading={loading} onRetry={load} stale={stale} styles={styles} />
      {calendarTarget && handledTarget.current !== calendarTarget && !loading && !stale ? <Text accessibilityRole="alert" style={styles.warningText}>This event is no longer available in this Calendar. Refresh the Calendar to check again.</Text> : null}
      {saveConfirmation ? <View style={styles.card}><Text style={styles.cardTitle}>{saveConfirmation}</Text></View> : null}
      {!selectedDate ? <Chips onChange={setFilter} options={[{ label: 'Upcoming', value: 'upcoming' }, { label: 'History', value: 'history' }, { label: 'Cancelled', value: 'cancelled' }, { label: 'All', value: 'all' }]} styles={styles} value={filter} /> : null}
      {policy.canCreate && !stale && !form && !focusedEventId ? <Button label="Create event" onPress={() => openForm()} styles={styles} /> : null}
      {form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{selected ? 'Edit event' : 'Create event'}</Text>
          <Chips onChange={(value) => setForm({ ...form, eventType: value })} options={['general', 'training', 'match', 'meeting', 'tournament', 'social', 'other'].map((value) => ({ label: value, value }))} styles={styles} value={form.eventType} />
          {form.eventType === 'match'
            ? <Field label="Opponent" onChangeText={(value) => setForm({ ...form, opponent: value })} styles={styles} value={form.opponent} />
            : <Field label="Title" onChangeText={(value) => setForm({ ...form, title: value })} styles={styles} value={form.title} />}
          {contextModel.isTeamScope ? <>
            <Field label="Your Team notification name" onChangeText={(value) => setForm({ ...form, notificationTeamName: value })} placeholder="Example: U14 JPL" styles={styles} value={form.notificationTeamName} />
            <Text style={styles.meta}>This is Your Team, not the opponent. It is used in notifications only. The official Team name does not change.</Text>
            <View style={styles.row}><Text style={styles.fieldLabel}>Remember this name for Your Team</Text><Switch accessibilityLabel="Remember this name for Your Team" onValueChange={(value) => setForm({ ...form, rememberNotificationTeamName: value })} value={form.rememberNotificationTeamName === true} /></View>
          </> : null}
          <CoachDateTimeField label="Date" mode="date" onChange={(value) => setForm({ ...form, date: value })} styles={styles} value={form.date} />
          <CoachDateTimeField label="Start time" mode="time" onChange={(value) => setForm({ ...form, startTime: value })} styles={styles} value={form.startTime} />
          <CoachDateTimeField label="End time" mode="time" onChange={(value) => setForm({ ...form, endTime: value })} styles={styles} value={form.endTime} />
          <LocationField locations={savedLocations} onChange={(value) => setForm({ ...form, location: value })} styles={styles} value={form.location} />
          <Field label="Notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} />
          <View style={styles.row}><Text style={styles.fieldLabel}>Pin shared notes</Text><Switch accessibilityLabel="Pin shared notes" disabled={!form.notes?.trim()} onValueChange={(value) => setForm({ ...form, notesPinned: value })} value={Boolean(form.notesPinned && form.notes?.trim())} /></View>
          <Text style={styles.meta}>Pinned notes appear first in event details for everyone who can see this event. Repeating dates share the same notes and pin setting.</Text>
          {contextModel.isTeamScope && Number(user.roleRank || 0) >= 50 ? (
            <View style={styles.stack}>
              <Text style={styles.fieldLabel}>Event attachments</Text>
              <Text style={styles.body}>Attachments apply only to {formatCoachCalendarFormDate(selected?.occurrenceDate || selected?.calendarDate || form.date)}. Other dates in this repeat series keep their own attachments.</Text>
              {(form.resourceIds || []).length > 0 ? (
                <View style={styles.stack}>
                  <Text style={styles.label}>Selected attachments</Text>
                  {resources.filter((resource) => (form.resourceIds || []).includes(resource.id)).map((resource) => (
                    <Button key={resource.id} label={`Remove ${resource.title}`} onPress={() => setForm({ ...form, resourceIds: toggleCoachCalendarResourceId(form.resourceIds, resource.id) })} styles={styles} />
                  ))}
                </View>
              ) : <Text style={styles.body}>No attachments selected for this date.</Text>}
              {resources.length ? <Button label={attachmentPickerOpen ? 'Close attachment picker' : 'Add or change attachments'} onPress={() => setAttachmentPickerOpen((current) => !current)} secondary styles={styles} /> : <><Text style={styles.body}>No active Team Resources are available.</Text><Button label="Open Resources" onPress={() => onNavigate('resources')} secondary styles={styles} /></>}
              {attachmentPickerOpen && resources.length ? (
                <View style={styles.pickerPanel}>
                  <Text style={styles.fieldLabel}>1. Choose a category</Text>
                  <Chips onChange={setAttachmentCategory} options={[{ label: 'All', value: 'all' }, ...attachmentCategories.map((category) => ({ label: formatResourceCategory(category), value: category }))]} styles={styles} value={attachmentCategory} />
                  <Text style={styles.fieldLabel}>2. Select one or more Resources</Text>
                  {resources.filter((resource) => attachmentCategory === 'all' || String(resource.category || 'general').trim().toLowerCase() === attachmentCategory).map((resource) => {
                    const attached = (form.resourceIds || []).includes(resource.id)
                    return <Button key={resource.id} label={`${attached ? 'Selected' : 'Add'} ${resource.title}`} onPress={() => setForm({ ...form, resourceIds: toggleCoachCalendarResourceId(form.resourceIds, resource.id) })} secondary={!attached} styles={styles} />
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
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
          <Button label="Cancel" onPress={() => { setForm(null); setFormError(''); setSelected(null); setAttachmentPickerOpen(false) }} secondary styles={styles} />
        </View>
      ) : null}
      {!loading && groups.length === 0 ? <Text style={styles.body}>No Calendar items match this filter.</Text> : null}
      {groups.map((group) => (
        <View key={formatUkDate(group.date, 'Date to be confirmed')} style={styles.stack}>
          <Text style={styles.label}>{formatUkDate(group.date)}</Text>
          {group.events.map((event) => (
            <Pressable accessibilityRole="button" key={event.id} onPress={() => setSelected(selected?.id === event.id ? null : event)} style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><MaterialIcons accessibilityLabel={event.sourceType === 'match_day' || event.eventType === 'match' ? 'Match' : event.eventType === 'training' ? 'Training' : event.sourceType === 'assessment_session' || event.eventType === 'development' ? 'Development' : 'Calendar event'} name={event.sourceType === 'match_day' || event.eventType === 'match' ? 'sports-soccer' : event.eventType === 'training' ? 'fitness-center' : event.sourceType === 'assessment_session' || event.eventType === 'development' ? 'trending-up' : 'event'} size={26} color={palette.accentText} /><Text style={[styles.cardTitle, { flex: 1 }]}>{event.title}</Text></View>
              {selected?.id === event.id ? <PinnedEventNotes notes={event.notes} pinned={event.notesPinned} styles={styles} colors={palette} /> : null}
              <Text style={styles.meta}>{formatCoachCalendarEventDateTime(event)} | {event.eventType} | {event.teamName || context.teamName || 'Club-wide'} | {event.status}</Text>
              {event.sourceType === 'match_day' ? <Text style={styles.meta}>{event.homeAway === 'away' ? 'Away' : 'Home'} fixture | {getMatchDayShirtChoiceLabel(event.shirtChoice)}</Text> : null}
              {event.dateTimeIssue === 'invalid_local_time' ? <Text style={styles.warningText}>Please update this event's time before editing it.</Text> : null}
              {event.location ? <Text style={styles.body}>{event.location}</Text> : null}
              {event.availabilitySummary ? <Text style={styles.meta}>Attending {event.availabilitySummary.attending} | Maybe {event.availabilitySummary.maybe} | Awaiting response {event.availabilitySummary.awaitingResponse} | Not attending {event.availabilitySummary.notAttending} | Invitation not sent {event.availabilitySummary.invitationNotSent} | Delivery issue {event.availabilitySummary.deliveryIssue}</Text> : null}
              {selected?.id === event.id ? <>{!event.notesPinned ? <Text style={styles.body}>{event.notes || 'No notes.'}</Text> : null}<VenueMapPreview key={event.location} location={event.location} offline={stale} colors={palette} styles={styles} />{event.location ? <Button label="Get directions" onPress={() => void openVenueDirections(event.location).catch(() => setError('Directions could not be opened.'))} secondary styles={styles} /> : null}{getCoachCalendarEventResourceIds(resources, event.sourceId, event.occurrenceDate || event.calendarDate, event.sourceType).map((resourceId) => {
                const resource = resources.find((item) => item.id === resourceId)
                return resource ? <Button key={resource.id} label={`Open ${resource.title}`} onPress={() => void openEventResource(resource)} secondary styles={styles} /> : null
              })}{canAddEventResource(event) ? <Button disabled={saving} label="Add resource" onPress={() => void openResourceEditor(event)} secondary styles={styles} /> : null}{event.sourceType === 'match_day' ? <><Button label="Open Match Day" onPress={() => onNavigate('matchday', { fixtureId: event.sourceId })} secondary styles={styles} />{canEditCoachFixture({ context, fixture: event, stale: stale || user.isOfflineProfile }) ? <Button label="Edit fixture" onPress={() => onNavigate('matchday', { fixtureId: event.sourceId, intent: 'edit-fixture', returnCalendarTarget: { sourceId: event.sourceId, sourceType: 'match_day' } })} secondary styles={styles} /> : null}</> : null}{event.sourceType === 'assessment_session' ? <View style={styles.filterRow}><Button label="Open Session" onPress={() => onNavigate('sessions')} secondary styles={styles} /><Button label="Open Development" onPress={() => onNavigate('development')} secondary styles={styles} /></View> : null}{!stale && getCoachCalendarMutationPolicy({ context, event }).canEdit ? <><Button label="Edit event" onPress={() => openForm(event)} secondary styles={styles} /><View style={styles.filterRow}><Button disabled={saving} label="Cancel event" onPress={() => void changeEventState('cancelled')} secondary styles={styles} /><Button danger disabled={saving} label="Delete event" onPress={() => void changeEventState('deleted')} secondary styles={styles} /></View></> : !['calendar_event', 'match_day'].includes(event.sourceType) ? <Text style={styles.meta}>Edit this item from its {event.sourceType === 'match_day' ? 'Match Day' : event.sourceType === 'assessment_session' ? 'Assessment Session' : 'web'} screen.</Text> : null}</> : null}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  )
}

export function CoachPlayersScreen({ context, onNavigate, onQuickActionHandled, onRequestScrollTop, palette, quickAction, user }) {
  const styles = useDomainStyles(palette)
  const [players, setPlayers] = useState([])
  const [focusedPlayer, setFocusedPlayer] = useState(null)
  const [openingPlayerId, setOpeningPlayerId] = useState('')
  const playerRequest = useRef(0)
  useEffect(() => () => { playerRequest.current += 1 }, [user])
  const [detail, setDetail] = useState(null)
  const [developmentOpen, setDevelopmentOpen] = useState(false)
  const [profileSections, setProfileSections] = useState({ notes: false, stats: false, details: false })
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState('all')
  const [saving, setSaving] = useState(false)
  const saveRequest = useRef(false)
  const [stale, setStale] = useState(false)
  const [contactBusy, setContactBusy] = useState('')
  const contactRequest = useRef(false)
  const [contactNotice, setContactNotice] = useState('')
  const [revokeTarget, setRevokeTarget] = useState(null)
  const policy = getCoachPlayerMutationPolicy({ context, player: detail?.player })
  const load = useCallback(async ({ reuseFresh = false } = {}) => {
    const recent = reuseFresh ? peekMobileResource(user, 'coach:players') : undefined
    if (recent !== undefined) { setPlayers(recent); setStale(false); setLoading(false); setError(''); return }
    setError(''); setLoading(true)
    const cached = await readCoachOfflineResources(user.id, context).catch(() => null)
    const hasCachedPlayers = Array.isArray(cached?.resources?.players)
    if (hasCachedPlayers) { setPlayers(cached.resources.players); setStale(true); setLoading(false) }
    try {
      const rows = await readMobileResource(user, 'coach:players', () => getCoachPlayerList(user), { force: !reuseFresh })
      setPlayers(rows); setStale(false)
      await saveCoachOfflineResources(user.id, context, { players: rows })
    } catch (loadError) {
      if (!hasCachedPlayers) setError(message(loadError, 'Players could not be loaded.'))
    } finally { setLoading(false) }
  }, [context, user])
  useEffect(() => { void load({ reuseFresh: true }) }, [load])
  useEffect(() => {
    if (quickAction?.intent !== 'create-player') return
    playerRequest.current += 1
    setOpeningPlayerId('')
    setFocusedPlayer(null)
    setDetail(null)
    setForm(coachPlayerFormFromPlayer())
    onQuickActionHandled?.()
  }, [onQuickActionHandled, quickAction])
  const visible = filterCoachPlayers(players, { query, section, status: 'active' })
  const openPlayer = async (player, { force = false } = {}) => {
    const request = ++playerRequest.current
    setFocusedPlayer(player)
    setForm(null)
    setOpeningPlayerId(player.id)
    onRequestScrollTop?.()
    setError('')
    setDetail(null)
    setDevelopmentOpen(false)
    setProfileSections({ notes: false, stats: false, details: false })
    setContactNotice('')
    setRevokeTarget(null)
    try {
      const next = await readMobileResource(user, `coach:player-detail:${player.id}`, () => getCoachPlayerDetail(user, player.id), { force })
      if (request === playerRequest.current) {
        if (next?.player?.id !== player.id) throw new Error('The selected player could not be loaded. Please try again.')
        setDetail(next)
      }
    } catch (detailError) {
      if (request === playerRequest.current) setError(message(detailError, 'Player details could not be loaded.'))
    } finally {
      if (request === playerRequest.current) setOpeningPlayerId('')
    }
  }
  const closePlayer = () => {
    playerRequest.current += 1
    setOpeningPlayerId('')
    setFocusedPlayer(null)
    setDetail(null)
    setDevelopmentOpen(false)
    setProfileSections({ notes: false, stats: false, details: false })
    setForm(null)
    setError('')
    setContactNotice('')
    setRevokeTarget(null)
    onRequestScrollTop?.()
  }
  const save = async () => {
    if (saveRequest.current || !form) return
    saveRequest.current = true
    const request = playerRequest.current
    setSaving(true); setError('')
    try {
      const saved = await saveCoachPlayer(user, form, detail?.player || null)
      setPlayers((current) => (current.some((player) => player.id === saved.id)
        ? current.map((player) => player.id === saved.id ? saved : player)
        : [...current, saved]).sort((a, b) => a.playerName.localeCompare(b.playerName)))
      invalidateMobileResource(user, `coach:player-detail:${saved.id}`)
      invalidateMobileResource(user, 'coach:players')
      if (request !== playerRequest.current) return
      const openingRequest = playerRequest.current + 1
      await openPlayer(saved)
      if (openingRequest === playerRequest.current) setContactNotice('Player saved. Use the Parent invite button beside a contact to send their invitation.')
    } catch (saveError) {
      if (request === playerRequest.current) setError(message(saveError, 'Player could not be saved.'))
    } finally { saveRequest.current = false; setSaving(false) }
  }
  const cancelForm = () => { setForm(null); setError(''); onRequestScrollTop?.() }
  const editPlayer = () => { setForm(coachPlayerFormFromPlayer(detail.player)); setContactNotice(''); onRequestScrollTop?.() }
  const toggleProfileSection = (sectionName) => setProfileSections((current) => ({ ...current, [sectionName]: !current[sectionName] }))
  const updateContact = (index, changes) => setForm((current) => ({ ...current, parentContacts: current.parentContacts.map((contact, i) => i === index ? { ...contact, ...changes } : contact) }))
  const manageParent = async (contact, revoke = false) => {
    if (contactRequest.current || !detail || !policy.canEdit) return
    contactRequest.current = true
    const request = playerRequest.current
    const playerId = detail.player.id
    setContactBusy(contact.email || contact.id); setContactNotice(''); setError('')
    try {
      const result = revoke
        ? await revokeCoachParentAccess(user, playerId, contact.id)
        : await sendCoachParentInvite(user, playerId, contact)
      invalidateMobileResource(user, `coach:player-detail:${playerId}`)
      const links = await getCoachParentLinks(user, playerId)
      if (request === playerRequest.current) {
        setDetail((current) => ({ ...current, parentLinks: links, parentLinksError: '' }))
        setRevokeTarget(null)
        setContactNotice(revoke ? 'Parent access removed for this player. You can now edit or remove their contact details.' : result?.alreadyLinked ? 'This parent already has access.' : `Parent invite sent to ${contact.email}.`)
      }
    } catch (contactError) {
      if (request === playerRequest.current) setError(message(contactError, 'Parent access could not be updated.'))
    } finally { contactRequest.current = false; setContactBusy('') }
  }
  return (
    <View style={styles.stack}>
      {focusedPlayer && !form ? <Pressable accessibilityLabel="Back to Players" accessibilityRole="button" onPress={closePlayer} style={[styles.profileAction, { alignSelf: 'flex-start' }]}><MaterialIcons color={palette.accentText} name="arrow-back" size={20} /><Text style={styles.profileActionText}>Players</Text></Pressable> : null}
      {form ? <Button disabled={saving} label={detail ? 'Back to player profile' : 'Back to Players'} onPress={cancelForm} secondary styles={styles} /> : null}
      <DomainHeader copy={focusedPlayer ? "Player information, contacts and development history." : "Your squad and trial players."} styles={styles} title={focusedPlayer ? "Player profile" : "Players"} />
      <DomainState error={error} loading={!focusedPlayer && loading} onRetry={focusedPlayer ? () => openPlayer(focusedPlayer) : load} stale={stale} styles={styles} />
      {!focusedPlayer && !form ? <>
      <Field label="Search Players" onChangeText={setQuery} styles={styles} value={query} />
      <Chips onChange={setSection} options={[{ label: 'All', value: 'all' }, { label: 'Trial', value: 'Trial' }, { label: 'Squad', value: 'Squad' }]} styles={styles} value={section} />
      {policy.canCreate && !form ? <Button iconKey="action.add-player" label="Add Player" onPress={() => { setDetail(null); setForm(coachPlayerFormFromPlayer()) }} styles={styles} /> : null}
      </> : null}
      {form ? (
        <View style={styles.form}>
          <Text style={styles.cardTitle}>{detail ? 'Edit Player' : 'Add Player'}</Text>
          <Field label="Player name" onChangeText={(value) => setForm({ ...form, playerName: value })} styles={styles} value={form.playerName} />
          <Chips onChange={(value) => setForm({ ...form, section: value })} options={[{ label: 'Trial', value: 'Trial' }, { label: 'Squad', value: 'Squad' }]} styles={styles} value={form.section} />
          <Field label="Shirt number" onChangeText={(value) => setForm({ ...form, shirtNumber: value })} styles={styles} value={form.shirtNumber} />
          <Field label="Positions, separated by commas" onChangeText={(value) => setForm({ ...form, positions: value })} styles={styles} value={form.positions} />
          <Chips onChange={(value) => setForm({ ...form, contactType: value })} options={[{ label: 'Parent contact', value: 'parent' }, { label: 'Adult Player', value: 'self' }]} styles={styles} value={form.contactType} />
          <Text style={styles.cardTitle}>Contacts</Text>
          {form.parentContacts.map((contact, index) => {
            const linked = detail?.parentLinks?.some((link) => link.email.toLowerCase() === contact.email.toLowerCase())
            return <View key={index} style={styles.card}>
              <Field label={`Contact ${index + 1} name`} onChangeText={(name) => updateContact(index, { name })} styles={styles} value={contact.name} />
              <Field label={`Contact ${index + 1} email`} onChangeText={(email) => updateContact(index, { email })} styles={styles} value={contact.email} />
              {linked ? <Text style={styles.meta}>To change this email or remove the contact, go back and remove their Parent access first.</Text> : null}
              <Button disabled={saving || linked} label={`Remove contact ${index + 1}`} onPress={() => setForm({ ...form, parentContacts: form.parentContacts.filter((_, i) => i !== index) })} secondary styles={styles} />
            </View>
          })}
          <Button disabled={saving} label="Add another contact" onPress={() => setForm({ ...form, parentContacts: [...form.parentContacts, { name: '', email: '', type: form.contactType }] })} secondary styles={styles} />
          <Field label="Private notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} />
          <Button disabled={saving} label={saving ? 'Saving...' : 'Save Player'} onPress={save} styles={styles} />
          <Button disabled={saving} label="Cancel" onPress={cancelForm} secondary styles={styles} />
        </View>
      ) : null}
      {detail && !form ? (
        <View style={styles.stack}>
          <View style={styles.profileHeader}>
            <View style={styles.profileIdentity}><MaterialIcons accessibilityLabel="Player" color={palette.accentText} name="person" size={27} /></View>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}><Text style={styles.cardTitle}>{detail.player.playerName}</Text><Text style={styles.meta}>{detail.player.section} | {detail.player.positions.join(', ') || 'No position'} | Shirt {detail.player.shirtNumber || 'not set'}</Text></View>
            {policy.canEdit ? <Pressable accessibilityLabel="Edit Player" accessibilityRole="button" accessibilityState={{ disabled: Boolean(contactBusy) }} disabled={Boolean(contactBusy)} onPress={editPlayer} style={styles.profileAction}><MaterialIcons color={palette.accentText} name="edit" size={18} /><Text style={styles.profileActionText}>Edit</Text></Pressable> : null}
          </View>
          <View style={styles.profileSection}>
            <View style={styles.row}><Text style={styles.profileSectionTitle}>Parent and player contacts</Text>{policy.canEdit ? <Pressable accessibilityLabel="Manage contacts" accessibilityRole="button" accessibilityState={{ disabled: Boolean(contactBusy) }} disabled={Boolean(contactBusy)} onPress={editPlayer} style={styles.profileAction}><MaterialIcons color={palette.accentText} name="manage-accounts" size={18} /><Text style={styles.profileActionText}>Manage</Text></Pressable> : null}</View>
          {contactNotice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{contactNotice}</Text> : null}
          {detail.parentLinksError ? <Text style={styles.danger}>{detail.parentLinksError}</Text> : null}
          {detail.player.parentContacts.length ? detail.player.parentContacts.map((contact, index) => {
            const action = getParentPortalInviteActionForContact({ contact, links: detail.parentLinks || [], player: detail.player, isSending: Boolean(contactBusy) })
            const link = detail.parentLinks?.find((item) => item.email.toLowerCase() === contact.email.toLowerCase())
            return <View key={`${contact.email}:${index}`} style={styles.profileRow}>
              <MaterialIcons color={palette.accentText} name={contact.type === 'self' ? 'person' : 'groups'} size={25} />
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}><Text style={styles.fieldLabel}>{contact.name || (contact.type === 'self' ? 'Adult player' : 'Parent contact')}</Text><Text selectable style={styles.body}>{contact.email || 'No email added'}</Text>{action.statusLabel ? <Text style={styles.meta}>{action.statusLabel}</Text> : null}</View>
              {policy.canEdit && !detail.parentLinksError && action.label ? <Pressable accessibilityLabel={contactBusy === contact.email ? 'Sending Parent app invite' : action.label.replace('parent portal', 'Parent app')} accessibilityRole="button" accessibilityState={{ busy: Boolean(contactBusy), disabled: Boolean(contactBusy) }} disabled={Boolean(contactBusy)} onPress={() => manageParent(contact)} style={styles.profileAction}><MaterialIcons color={palette.accentText} name="send" size={18} /></Pressable> : null}
              {policy.canEdit && link ? <Pressable accessibilityLabel="Remove Parent access" accessibilityRole="button" accessibilityState={{ disabled: Boolean(contactBusy) }} disabled={Boolean(contactBusy)} onPress={() => setRevokeTarget(link)} style={styles.profileAction}><MaterialIcons color={palette.danger} name="delete-outline" size={20} /></Pressable> : null}
            </View>
          }) : <Text style={styles.body}>No contacts added yet. Add a parent contact to invite them to the Parent app.</Text>}
          {getUnlistedParentAccessLinks({ contacts: detail.player.parentContacts, links: detail.parentLinks || [] }).map((link) => <View key={link.id} style={styles.profileRow}>
            <MaterialIcons color={palette.accentText} name="group-add" size={25} /><View style={{ flex: 1, gap: 2, minWidth: 0 }}><Text style={styles.fieldLabel}>Additional Parent access</Text><Text selectable style={styles.body}>{link.email}</Text><Text style={styles.meta}>{link.status === 'active' ? 'Parent app linked' : 'Invitation pending'}. This account is not in the contact list.</Text></View>
            {policy.canEdit ? <Pressable accessibilityLabel="Remove Parent access" accessibilityRole="button" accessibilityState={{ disabled: Boolean(contactBusy) }} disabled={Boolean(contactBusy)} onPress={() => setRevokeTarget(link)} style={styles.profileAction}><MaterialIcons color={palette.danger} name="delete-outline" size={20} /></Pressable> : null}
          </View>)}
          {revokeTarget ? <View style={styles.profileSection}>
            <Text style={styles.cardTitle}>Remove Parent access?</Text>
            <Text style={styles.body}>{revokeTarget.email} will lose Parent app access to this player. Their contact details stay until you edit them.</Text>
            <View style={styles.filterRow}><Pressable accessibilityLabel={contactBusy ? 'Removing access...' : 'Confirm remove access'} accessibilityRole="button" accessibilityState={{ disabled: Boolean(contactBusy), busy: Boolean(contactBusy) }} disabled={Boolean(contactBusy)} onPress={() => manageParent(revokeTarget, true)} style={styles.profileAction}><MaterialIcons color={palette.danger} name="delete-outline" size={20} /><Text style={[styles.profileActionText, { color: palette.danger }]}>{contactBusy ? 'Removing access...' : 'Remove access'}</Text></Pressable><Pressable accessibilityLabel="Keep access" accessibilityRole="button" accessibilityState={{ disabled: Boolean(contactBusy) }} disabled={Boolean(contactBusy)} onPress={() => setRevokeTarget(null)} style={styles.profileAction}><Text style={styles.profileActionText}>Keep access</Text></Pressable></View>
          </View> : null}
          </View>
          <View style={styles.profileSection}>
            <Pressable accessibilityLabel={profileSections.notes ? 'Hide private notes' : 'Show private notes'} accessibilityRole="button" accessibilityState={{ expanded: profileSections.notes }} aria-expanded={profileSections.notes} onPress={() => toggleProfileSection('notes')} style={styles.profileSectionButton}><Text style={styles.profileSectionTitle}>Private notes</Text><MaterialIcons color={palette.textMuted} name={profileSections.notes ? 'expand-less' : 'expand-more'} size={24} /></Pressable>
            {profileSections.notes ? <Text style={styles.body}>{detail.player.notes || 'No private notes.'}</Text> : null}
          </View>
          <View style={styles.profileSection}>
            <Pressable accessibilityLabel={profileSections.stats ? 'Hide match stats' : 'Show match stats'} accessibilityRole="button" accessibilityState={{ expanded: profileSections.stats }} aria-expanded={profileSections.stats} onPress={() => toggleProfileSection('stats')} style={styles.profileSectionButton}><Text style={styles.profileSectionTitle}>Match stats</Text><MaterialIcons color={palette.textMuted} name={profileSections.stats ? 'expand-less' : 'expand-more'} size={24} /></Pressable>
            {profileSections.stats ? <>
            {detail.matchStats ? <>
              <Text style={styles.meta}>Calendar year {detail.matchStats.year}</Text>
              <View style={styles.filterRow}>
                {[['Matchday squad', detail.matchStats.matchdaySquad], ['Goals', detail.matchStats.goals], ['Assists', detail.matchStats.assists]].map(([label, value]) => <View key={label} style={styles.profileStat}><Text style={styles.cardTitle}>{value ?? 'Not available'}</Text><Text style={styles.meta}>{label}</Text></View>)}
              </View>
              <Text style={styles.body}>Matchday squad counts completed matches where this player was selected. Goals and assists come from saved scoring records.</Text>
            </> : <Text style={styles.body}>{detail.matchStatsError || 'No match stats available yet.'}</Text>}
            </> : null}
          </View>
          <View style={styles.profileSection}>
            <Pressable accessibilityLabel="Refresh player details" accessibilityRole="button" accessibilityState={{ busy: Boolean(openingPlayerId), disabled: Boolean(openingPlayerId) }} disabled={Boolean(openingPlayerId)} onPress={() => openPlayer(detail.player, { force: true })} style={styles.profileSectionButton}><Text style={styles.profileSectionTitle}>Player details</Text><MaterialIcons color={palette.accentText} name="refresh" size={22} /></Pressable>
            <Pressable accessibilityLabel={profileSections.details ? 'Hide player details' : 'Show player details'} accessibilityRole="button" accessibilityState={{ expanded: profileSections.details }} aria-expanded={profileSections.details} onPress={() => toggleProfileSection('details')} style={styles.profileSectionButton}><Text style={styles.meta}>Custom fields and Session history</Text><MaterialIcons color={palette.textMuted} name={profileSections.details ? 'expand-less' : 'expand-more'} size={24} /></Pressable>
            {profileSections.details ? <><Text style={styles.fieldLabel}>Custom fields</Text><Text style={styles.body}>{detail.fields.map((field) => field.label).join(', ') || 'No enabled fields.'}</Text><Text style={styles.fieldLabel}>Session history</Text>{detail.sessions.length ? detail.sessions.map((session) => <Text key={session.id} style={styles.body}>{formatUkDate(session.sessionDate)} | {session.title} | {session.status}</Text>) : <Text style={styles.body}>No Session history.</Text>}</> : null}
          </View>
          <View style={styles.profileSection}>
            <View style={styles.row}><Text style={styles.profileSectionTitle}>Development</Text><View style={styles.filterRow}><Pressable accessibilityLabel="Open Development" accessibilityRole="button" onPress={() => onNavigate('development')} style={styles.profileAction}><MaterialIcons color={palette.accentText} name="trending-up" size={18} /></Pressable><Pressable accessibilityLabel="Open Resources" accessibilityRole="button" onPress={() => onNavigate('resources')} style={styles.profileAction}><MaterialIcons color={palette.accentText} name="folder-open" size={18} /></Pressable></View></View>
            {detail.evaluations.length ? <>
              <Text style={styles.meta}>{detail.evaluations.length} saved record{detail.evaluations.length === 1 ? '' : 's'}. Latest: {formatUkDate(detail.evaluations[0]?.date, 'No date')} | Score {detail.evaluations[0]?.averageScore ?? 'not scored'}.</Text>
              <Pressable accessibilityLabel={developmentOpen ? 'Hide recent records' : 'Show recent records'} accessibilityRole="button" accessibilityState={{ expanded: developmentOpen }} aria-expanded={developmentOpen} onPress={() => setDevelopmentOpen((current) => !current)} style={styles.profileSectionButton}><Text style={styles.profileActionText}>{developmentOpen ? 'Hide recent records' : 'Show recent records'}</Text><MaterialIcons color={palette.accentText} name={developmentOpen ? 'expand-less' : 'expand-more'} size={24} /></Pressable>
              {developmentOpen ? detail.evaluations.slice(0, 5).map((evaluation) => <Text key={evaluation.id} style={styles.body}>{formatUkDate(evaluation.date, 'No date')} | {evaluation.session || 'Evaluation'} | Score {evaluation.averageScore ?? 'not scored'} | {evaluation.comments || 'No comments'}</Text>) : null}
              {developmentOpen && detail.evaluations.length > 5 ? <Text style={styles.meta}>Showing the 5 most recent records. Open Development for the full history.</Text> : null}
            </> : <Text style={styles.body}>No Development records.</Text>}
          </View>
          <Text style={styles.meta}>Use the website to archive a player or transfer them to another team.</Text>
        </View>
      ) : null}
      {!focusedPlayer && !form && !loading && visible.length === 0 ? <Text style={styles.body}>No active Players match this view.</Text> : null}
      {openingPlayerId ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Opening {focusedPlayer?.playerName || 'Player'}...</Text> : null}
      {!focusedPlayer && !form ? visible.map((player) => <Pressable accessibilityState={{ busy: openingPlayerId === player.id }} accessibilityRole="button" key={player.id} onPress={() => openPlayer(player)} style={styles.playerCard}><MaterialIcons name="person-outline" size={28} style={styles.secondaryText} /><View style={styles.playerCopy}><Text numberOfLines={1} style={styles.cardTitle}>{player.playerName}</Text><Text numberOfLines={1} style={styles.meta}>{player.section} | {player.positions.join(', ') || 'No position'} | Shirt {player.shirtNumber || 'not set'}</Text><ParentAppInstallationStatus player={player} styles={styles} /></View><MaterialIcons name="chevron-right" size={22} style={styles.secondaryText} /></Pressable>) : null}
    </View>
  )
}

export function CoachSessionsScreen({ context, onNavigate, onQuickActionHandled, palette, quickAction, user }) {
  const styles = useDomainStyles(palette)
  const [sessions, setSessions] = useState([])
  const [players, setPlayers] = useState([])
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [cacheWarning, setCacheWarning] = useState('')
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
  const load = useCallback(async ({ reuseFresh = false } = {}) => {
    setError(''); setCacheWarning(''); setLoading(true)
    const saveOfflineCopy = createCoachOfflineResourceSaver(user, context)
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
        withMobileAsyncTimeout(() => readMobileResource(user, 'coach:sessions', () => getCoachSessionList(user), { force: !reuseFresh })),
        withMobileAsyncTimeout(() => readMobileResource(user, 'coach:players', () => getCoachPlayerList(user), { force: !reuseFresh })),
        withMobileAsyncTimeout(() => readMobileResource(user, 'coach:calendar', () => getCoachCalendarResources(user), { force: !reuseFresh })),
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
      try {
        await saveOfflineCopy({ sessionPlayers: playerRows, sessions: rows, trainingEvents: nextTrainingEvents, trainingLocations: nextTrainingLocations })
      } catch (cacheError) {
        // The live read succeeded. A rejected cache write must not report a load failure.
        setCacheWarning(getCoachOfflineSaveWarning(cacheError))
      }
    } catch (loadError) {
      const accessDenied = loadError?.code === '42501' || /permission denied|row.level security|not authori[sz]ed/i.test(String(loadError?.message || ''))
      if (accessDenied) {
        setSessions([]); setPlayers([]); setTrainingEvents([]); setTrainingLocations([]); setStale(true)
      }
      setError(accessDenied
        ? 'Your current access does not allow these Sessions to be loaded. Refresh your workspace or contact a club administrator.'
        : message(loadError, hasCachedSessions ? 'Sessions could not be refreshed. Showing saved information.' : 'Sessions could not be loaded.'))
    } finally { setLoading(false) }
  }, [context, user])
  useEffect(() => { void load({ reuseFresh: true }) }, [load])
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
      {cacheWarning && !error ? <View accessibilityLiveRegion="polite" style={styles.profileSection}><View style={styles.row}><MaterialIcons name="cloud-off" size={20} color={palette.warning} /><Text style={[styles.body, { flex: 1 }]}>{cacheWarning}</Text></View><Pressable accessibilityRole="button" accessibilityState={{ disabled: loading }} disabled={loading} onPress={() => load()} style={styles.profileAction}><MaterialIcons name="refresh" size={20} color={palette.accentText} /><Text style={styles.profileActionText}>Try saving offline again</Text></Pressable></View> : null}
      {trainingNotice ? <View style={styles.profileSection}><Text style={styles.cardTitle}>{trainingNotice}</Text></View> : null}
      {policy.canCreate && !trainingForm && !form ? <Button label="Create training session" onPress={() => { setDetail(null); setTrainingForm(createTrainingForm()) }} styles={styles} /> : null}
      {trainingForm ? (
        <View style={styles.profileSection}>
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
      {trainingEvents.length ? <View style={styles.profileSection}><Text style={styles.cardTitle}>Upcoming training invitations</Text>{trainingEvents.slice(0, 8).map((event) => <Pressable accessibilityRole="button" key={event.id} onPress={() => onNavigate('calendar')} style={styles.stack}><Text style={styles.body}>{formatCoachCalendarEventDateTime(event)} | {event.title}</Text>{event.availabilitySummary ? <Text style={styles.meta}>Attending {event.availabilitySummary.attending} | Maybe {event.availabilitySummary.maybe} | Awaiting response {event.availabilitySummary.awaitingResponse} | Not attending {event.availabilitySummary.notAttending} | Invitation not sent {event.availabilitySummary.invitationNotSent} | Delivery issue {event.availabilitySummary.deliveryIssue}</Text> : null}</Pressable>)}</View> : null}
      <Text style={styles.cardTitle}>Assessment Sessions</Text>
      <Chips onChange={setFilter} options={[{ label: 'Upcoming', value: 'upcoming' }, { label: 'Completed', value: 'completed' }, { label: 'History', value: 'history' }, { label: 'All', value: 'all' }]} styles={styles} value={filter} />
      {getCoachSessionMutationPolicy({ context }).canCreate && !form && !trainingForm ? <Button label="Create assessment Session" onPress={() => { setDetail(null); setForm(coachSessionFormFromSession()) }} secondary styles={styles} /> : null}
      {form ? (
        <View style={styles.profileSection}>
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
        <View style={styles.profileSection}>
          <Text style={styles.cardTitle}>{detail.session.title}</Text>
          <Text style={styles.meta}>{formatUkDate(detail.session.sessionDate)} | {detail.session.startTime || 'Time not set'} | {detail.session.location || 'Location not set'} | {detail.session.status}</Text>
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
      {visible.map((session) => <Pressable accessibilityRole="button" key={session.id} onPress={() => openSession(session)} style={styles.profileSection}><Text style={styles.cardTitle}>{session.title}</Text><Text style={styles.meta}>{formatUkDate(session.sessionDate)} | {session.startTime || 'Time not set'} | {session.sessionType} | {session.status}</Text></Pressable>)}
    </View>
  )
}

function SessionPlayerNotes({ disabled, onSave, sessionPlayer, styles }) {
  const [notes, setNotes] = useState(sessionPlayer.notes)
  return (
    <View style={styles.profileSection}>
      <Text style={styles.cardTitle}>{sessionPlayer.playerName}</Text>
      <Field label={`Notes for ${sessionPlayer.playerName}`} multiline onChangeText={setNotes} styles={styles} value={notes} />
      <Button disabled={disabled} label="Save Player notes" onPress={() => onSave(notes)} secondary styles={styles} />
    </View>
  )
}
