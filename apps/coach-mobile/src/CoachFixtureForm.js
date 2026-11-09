import { MobileSwitch as Switch } from '../../mobile-core/src/MobileSwitch.js'
import * as Notifications from 'expo-notifications'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  calculateCoachArrivalTime,
  COACH_MATCH_ARRIVAL_OPTIONS,
  COACH_MATCH_DURATION_OPTIONS,
  COACH_PITCH_TYPE_OPTIONS,
  initializeCoachFixtureForm,
  isContinuousMatchClock,
  MATCH_CLOCK_MODE_OPTIONS,
  MATCH_DAY_CONCLUSION_RULE_OPTIONS,
  MATCH_DAY_EXTRA_TIME_PERIOD_COUNT_OPTIONS,
  MATCH_DAY_FIXTURE_TYPE_OPTIONS,
  MATCH_DAY_HOME_AWAY_OPTIONS,
  MATCH_DAY_SHIRT_CHOICE_OPTIONS,
  matchUsesExtraTime,
  updateCoachFixtureArrivalPreset,
  updateCoachFixtureKickoff,
} from '../../mobile-core/src/coachFixtureCore.js'
import { addCoachFixtureParents, archiveCoachMatchLocation, cancelCoachMatchDayFixture, createCoachMatchDayFixture, getCoachFixtureInvitedPlayerIds, getCoachMatchLocations, updateCoachMatchDayFixture } from '../../mobile-core/src/coachMatchDayData.js'
import { commitCoachCalendarChangeNotification, prepareCoachMatchCancellationNotification } from '../../mobile-core/src/coachCalendarData.js'
import { CoachDateTimeField } from './CoachDateTimeField'
import { readCoachFixturePreferences, writeCoachFixturePreferences } from './coachFixturePreferences'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import {
  getCoachOwnTeamFixturePreferences,
  getCoachTeamNotificationDisplayName,
  saveCoachOwnTeamFixturePreferences,
} from '../../mobile-core/src/coachTeamNotificationData'
import { deriveTeamNotificationDisplayName } from '../../../src/lib/team-notification-display.js'
import { getCoachCarpoolDefault, setCoachCarpoolDefault } from '../../mobile-core/src/coachCarpoolData'
import { CoachKeyboardFocusContext } from './CoachKeyboardFocusContext'
import { canPlayerJoinFixture } from '../../../src/lib/player-participation.js'

function Button({ disabled = false, label, onPress, secondary = false, styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [secondary ? styles.secondary : styles.action, disabled && styles.actionDisabled, pressed && { opacity: 0.74 }]}><Text style={secondary ? styles.secondaryText : styles.actionText}>{label}</Text></Pressable>
}

function Chips({ onChange, options, styles, value }) {
  return <View style={styles.fixtureChoices}>{options.map((option) => { const selected = value === option.value; return <Pressable accessibilityLabel={option.label} accessibilityRole="button" accessibilityState={{ selected }} aria-selected={selected} key={String(option.value)} onPress={() => onChange(option.value)} style={({ pressed }) => [styles.fixtureChoice, selected && styles.fixtureChoiceActive, pressed && styles.fixtureChoicePressed]}><Text style={[styles.fixtureChoiceText, selected && styles.fixtureChoiceTextActive]}>{option.label}</Text></Pressable> })}</View>
}

function Field({ autoCapitalize = 'sentences', keyboardType = 'default', label, multiline = false, onChangeText, placeholder = '', styles, value }) {
  const revealFocused = useContext(CoachKeyboardFocusContext)
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} autoCapitalize={autoCapitalize} keyboardType={keyboardType} multiline={multiline} onFocus={revealFocused} onContentSizeChange={multiline ? revealFocused : undefined} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={StyleSheet.flatten(styles.input).color} style={[styles.input, multiline && styles.inputMultiline]} value={String(value ?? '')} /></View>
}

function Toggle({ label, onValueChange, styles, value }) {
  return <View style={styles.row}><Text style={styles.fieldLabel}>{label}</Text><Switch accessibilityLabel={label} onValueChange={onValueChange} value={value === true} /></View>
}

export function CoachFixtureForm({ defaultMatchDate = '', match = null, matches, onCancel, onCancelled, onCreated, onRequestScrollTo, onUpdated, players, styles, user }) {
  const [locations, setLocations] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showCancellation, setShowCancellation] = useState(false)
  const [cancellationReason, setCancellationReason] = useState('')
  const [carpoolLoadError, setCarpoolLoadError] = useState('')
  const [carpoolReady, setCarpoolReady] = useState(false)
  const [carpoolSaving, setCarpoolSaving] = useState(false)
  const [carpoolEnabled, setCarpoolEnabled] = useState(false)
  const [invitedPlayerIds, setInvitedPlayerIds] = useState([])
  const [newParentPlayerIds, setNewParentPlayerIds] = useState([])
  const [parentInviteReady, setParentInviteReady] = useState(false)
  const selectionTouched = useRef(false)
  const locationSectionY = useRef(0)
  const isEditing = Boolean(match?.id)
  const eligiblePlayers = useMemo(() => players.filter((player) => canPlayerJoinFixture(player, form?.fixtureType || match?.fixtureType)), [form?.fixtureType, match?.fixtureType, players])

  useEffect(() => {
    let active = true
    setParentInviteReady(false)
    setNewParentPlayerIds([])
    if (!isEditing) return () => { active = false }
    void getCoachFixtureInvitedPlayerIds(user, match).then(ids => {
      if (!active) return
      setInvitedPlayerIds(ids)
      setParentInviteReady(true)
    }).catch(error => {
      if (active) setError(getCoachFriendlyError(error, 'Could not load the invited players.'))
    })
    return () => { active = false }
  }, [isEditing, match, user])

  const addParents = async () => {
    if (busy || !parentInviteReady || !newParentPlayerIds.length) return
    setBusy(true)
    setError('')
    try {
      const result = await addCoachFixtureParents(user, match, newParentPlayerIds.filter((id) => eligiblePlayers.some((player) => player.id === id)))
      if (result.warning) Alert.alert('Parents added, invitations need attention', result.warning)
      onUpdated?.({ ...result.match, parentInvitationsAddedCount: newParentPlayerIds.length })
    } catch (error) {
      setError(getCoachFriendlyError(error, 'Parents could not be added. Review the fixture before trying again.'))
    } finally { setBusy(false) }
  }

  useEffect(() => {
    let active = true
    setCarpoolReady(false)
    setCarpoolLoadError('')
    setCarpoolEnabled(isEditing ? match.carpoolEnabled !== false : false)
    getCoachCarpoolDefault(user).then(value => {
      if (!active) return
      setCarpoolEnabled(isEditing ? match.carpoolEnabled !== false : value)
      setCarpoolReady(true)
    }).catch(() => {
      if (!active) return
      setCarpoolLoadError('The saved Car pool preference could not be loaded. Car pool cannot be changed here and will stay unchanged when this fixture is saved.')
    })
    return () => { active = false }
  }, [user, match, isEditing])

  async function changeCarpool(enabled) {
    if (carpoolSaving || !carpoolReady) return
    setCarpoolSaving(true)
    setError('')
    try { setCarpoolEnabled(await setCoachCarpoolDefault(user, enabled)) }
    catch {
      try { setCarpoolEnabled(await getCoachCarpoolDefault(user)); setError('The last confirmed Car pool setting has been restored. Please check it before saving.') }
      catch {
        setCarpoolReady(false)
        setCarpoolLoadError('The Car pool preference could not be confirmed. Car pool will stay unchanged when this fixture is saved.')
        setError('The Car pool preference could not be confirmed. Fixture changes can still be saved without changing Car pool.')
      }
    }
    finally { setCarpoolSaving(false) }
  }

  useEffect(() => {
    let active = true
    void Promise.all([
      readCoachFixturePreferences(user.id, user.activeTeamId),
      getCoachTeamNotificationDisplayName(user),
      getCoachMatchLocations(user, matches),
      getCoachOwnTeamFixturePreferences(user),
    ])
      .then(([devicePreferences, notificationTeamName, savedLocations, sharedPreferences]) => {
        if (!active) return
        setLocations(savedLocations)
        const preferences = sharedPreferences.found
          ? {
            ...devicePreferences,
            arrivalPreset: sharedPreferences.arrivalPreset,
            arrivalTime: sharedPreferences.arrivalTime,
            duration: sharedPreferences.duration,
          }
          : devicePreferences
        const savedLocation = preferences.location?.name ? preferences.location : savedLocations[0] || null
        setForm((current) => initializeCoachFixtureForm(current, {
          defaultMatchDate,
          defaultArrivalPreset: preferences.arrivalPreset,
          defaultArrivalTime: preferences.arrivalTime,
          defaultDuration: preferences.duration,
          defaultLocation: savedLocation,
          defaultMotmPollExpiryDuration: preferences.motmPollExpiryDuration,
          defaultPlayerIds: eligiblePlayers.map((player) => player.id),
          match,
          notificationTeamName,
        }))
      })
      .catch(async () => {
        if (!active) return
        const preferences = await readCoachFixturePreferences(user.id, user.activeTeamId).catch(() => ({ duration: 90, location: null }))
        if (!active) return
        const savedLocation = preferences.location?.name ? preferences.location : null
        setForm((current) => initializeCoachFixtureForm(current, {
          defaultMatchDate,
          defaultArrivalPreset: preferences.arrivalPreset,
          defaultArrivalTime: preferences.arrivalTime,
          defaultDuration: preferences.duration,
          defaultLocation: savedLocation,
          defaultMotmPollExpiryDuration: preferences.motmPollExpiryDuration,
          defaultPlayerIds: eligiblePlayers.map((player) => player.id),
          match,
          notificationTeamName: deriveTeamNotificationDisplayName(user.activeTeamName || ''),
        }))
      })
    return () => { active = false }
  }, [defaultMatchDate, eligiblePlayers, match, matches, user, user.activeTeamId, user.id])

  useEffect(() => {
    if (isEditing || selectionTouched.current || eligiblePlayers.length === 0) return
    setForm((current) => current?.parentVisible && current.selectedPlayerIds.length === 0
      ? { ...current, selectedPlayerIds: eligiblePlayers.map((player) => player.id) } : current)
  }, [eligiblePlayers, isEditing])

  if (!form) return <View style={styles.card}><Text style={styles.body}>Preparing fixture setup...</Text></View>

  const save = async ({ calendarTarget = '' } = {}) => {
    if (busy || carpoolSaving) return
    Keyboard.dismiss()
    setError('')
    if (!isEditing && !String(form.venueName || '').trim()) {
      setError('Add a venue before creating this fixture.')
      onRequestScrollTo?.(locationSectionY.current)
      return
    }
    setBusy(true)
    const startedAt = Date.now()
    let creationPending = !isEditing
    let slowNotification = null
    const notify = (title, body) => Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }).catch(() => {})
    const slowNotice = !isEditing ? setTimeout(() => {
      if (creationPending) {
        slowNotification = Notifications.scheduleNotificationAsync({ content: { title: 'Match setup is taking longer', body: 'The fixture is still being checked. Please do not press Create again.' }, trigger: null })
          .then(async (id) => { if (!creationPending) await Notifications.dismissNotificationAsync(id).catch(() => {}); return id })
          .catch(() => '')
      }
    }, 10000) : null
    const calendarPlayerIds = eligiblePlayers.map((player) => player.id)
    const submittedForm = {
      ...form,
      ...(carpoolReady ? { carpoolEnabled } : {}),
      selectedPlayerIds: calendarTarget === 'squad'
        ? calendarPlayerIds
        : form.selectedPlayerIds.filter((id) => eligiblePlayers.some((player) => player.id === id)),
    }
    try {
      if (submittedForm.saveArrivalAsDefault || submittedForm.saveDurationAsDefault) {
        await saveCoachOwnTeamFixturePreferences(user, user.activeTeamId, submittedForm)
      }
      const result = isEditing
        ? await updateCoachMatchDayFixture(user, match, submittedForm)
        : await createCoachMatchDayFixture(user, submittedForm, { calendarTarget })
      creationPending = false
      if (slowNotice) clearTimeout(slowNotice)
      if (slowNotification) {
        const id = await slowNotification
        if (id) await Notifications.dismissNotificationAsync(id).catch(() => {})
      }
      let preferencesWarning = ''
      try {
        const currentPreferences = await readCoachFixturePreferences(user.id, user.activeTeamId)
        await writeCoachFixturePreferences(user.id, user.activeTeamId, {
          arrivalPreset: submittedForm.saveArrivalAsDefault ? submittedForm.arrivalPreset : currentPreferences.arrivalPreset,
          arrivalTime: submittedForm.saveArrivalAsDefault && submittedForm.arrivalPreset === 'custom' ? submittedForm.arrivalTime : currentPreferences.arrivalTime,
          duration: submittedForm.saveDurationAsDefault ? submittedForm.matchDurationMinutes : currentPreferences.duration,
          location: submittedForm.venueName ? { address: submittedForm.venueAddress, name: submittedForm.venueName } : null,
          motmPollExpiryDuration: submittedForm.saveMotmExpiryAsDefault
            ? submittedForm.motmPollExpiryDuration
            : currentPreferences.motmPollExpiryDuration,
        })
      } catch {
        preferencesWarning = 'Fixture saved, but this device could not remember its setup defaults.'
      }
      if (isEditing) onUpdated?.(result)
      else onCreated({ ...result, preferencesWarning })
    } catch (saveError) {
      creationPending = false
      if (slowNotice) clearTimeout(slowNotice)
      if (slowNotification) {
        const id = await slowNotification
        if (id) await Notifications.dismissNotificationAsync(id).catch(() => {})
      }
      const friendly = getCoachFriendlyError(saveError, 'The fixture could not be created.')
      const message = !isEditing && friendly.startsWith('We could not connect')
        ? 'Could not confirm fixture creation. Check Match Day before trying again.' : friendly
      const remaining = !isEditing ? Math.max(0, 10000 - (Date.now() - startedAt)) : 0
      if (remaining) await new Promise(resolve => setTimeout(resolve, remaining))
      if (!isEditing) void notify('Match setup needs attention', message)
      setError(message)
    } finally {
      if (slowNotice) clearTimeout(slowNotice)
      setBusy(false)
    }
  }

  const cancelFixture = async (notifyEveryone) => {
    if (busy || carpoolSaving || !isEditing) return
    setBusy(true)
    setError('')
    try {
      const preparation = notifyEveryone ? await prepareCoachMatchCancellationNotification(match) : null
      const cancelled = await cancelCoachMatchDayFixture(user, match, cancellationReason)
      let notificationMessage = ''
      if (preparation?.preparationId) {
        try {
          const delivery = await commitCoachCalendarChangeNotification(preparation.preparationId)
          notificationMessage = `${delivery.recipientCount || 0} involved contacts notified.`
        } catch {
          notificationMessage = 'The fixture was cancelled, but notifications could not be completed. Check the web Calendar before notifying families.'
        }
      }
      onCancelled?.(cancelled, notificationMessage)
    } catch (cancelError) {
      setError(getCoachFriendlyError(cancelError, 'The fixture could not be cancelled.'))
    } finally {
      setBusy(false)
    }
  }

  const confirmCancelFixture = () => {
    if (busy || carpoolSaving || !isEditing) return
    Alert.alert(
      'Cancel this fixture?',
      `${match.opponent} will be marked as cancelled. This cannot be undone here. Would you like to notify everyone involved?`,
      [
        { style: 'cancel', text: 'Go back' },
        { onPress: () => void cancelFixture(false), text: 'Cancel without notifying' },
        { onPress: () => void cancelFixture(true), style: 'destructive', text: 'Cancel and notify' },
      ],
    )
  }

  const selectLocation = (id) => {
    const location = locations.find((item) => item.id === id)
    if (location) setForm({ ...form, venueAddress: location.address, venueName: location.name })
  }
  const deleteLocation = async () => {
    const location = locations.find((item) => item.id === locationValue)
    if (!location) return
    setBusy(true)
    setError('')
    try {
      await archiveCoachMatchLocation(user, location)
      const nextLocations = await getCoachMatchLocations(user, matches)
      setLocations(nextLocations)
      setForm({ ...form, venueAddress: '', venueName: '' })
    } catch (deleteError) {
      setError(getCoachFriendlyError(deleteError, 'The saved address could not be deleted.'))
    } finally {
      setBusy(false)
    }
  }
  const confirmDeleteLocation = () => {
    const location = locations.find((item) => item.id === locationValue)
    if (!location) return
    Alert.alert(
      'Delete saved address?',
      `${location.label}\n\nExisting fixtures will keep their venue details.`,
      [
        { style: 'cancel', text: 'Cancel' },
        { onPress: deleteLocation, style: 'destructive', text: 'Delete' },
      ],
    )
  }
  const locationValue = locations.find((item) => item.name === form.venueName && item.address === form.venueAddress)?.id || ''
  const durationIsCustom = !COACH_MATCH_DURATION_OPTIONS.includes(Number(form.matchDurationMinutes))
  const hasEligiblePlayers = eligiblePlayers.length > 0

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{isEditing ? 'Edit fixture' : 'Create match'}</Text>
        <Text style={styles.body}>{isEditing ? 'Update the fixture details before the match starts.' : 'Create the full Match Day fixture first. Squad and live controls remain available after it is saved.'}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Fixture</Text>
        <Field label="Your Team notification name" onChangeText={(value) => setForm({ ...form, notificationTeamName: value })} placeholder="Example: U14 JPL" styles={styles} value={form.notificationTeamName} />
        <Text style={styles.meta}>This is Your Team, not the opponent. It is used in notifications only. The official Team name does not change.</Text>
        <Toggle label="Remember this name for Your Team" onValueChange={(value) => setForm({ ...form, rememberNotificationTeamName: value })} styles={styles} value={form.rememberNotificationTeamName} />
        <Field label="Opponent" onChangeText={(value) => setForm({ ...form, opponent: value })} styles={styles} value={form.opponent} />
        <Text style={styles.fieldLabel}>Fixture type</Text>
        <Chips onChange={(value) => setForm({ ...form, fixtureType: value, selectedPlayerIds: form.selectedPlayerIds.filter((id) => players.some((player) => player.id === id && canPlayerJoinFixture(player, value))) })} options={MATCH_DAY_FIXTURE_TYPE_OPTIONS} styles={styles} value={form.fixtureType} />
        <Text style={styles.fieldLabel}>How this match can finish</Text>
        <Chips onChange={(value) => setForm({ ...form, conclusionRule: value })} options={MATCH_DAY_CONCLUSION_RULE_OPTIONS} styles={styles} value={form.conclusionRule} />
        {matchUsesExtraTime(form) ? <><Text style={styles.fieldLabel}>Extra-time periods</Text><Chips onChange={(value) => setForm({ ...form, extraTimePeriodCount: value })} options={MATCH_DAY_EXTRA_TIME_PERIOD_COUNT_OPTIONS} styles={styles} value={form.extraTimePeriodCount} /><Field label="Extra-time period minutes" onChangeText={(value) => setForm({ ...form, extraTimeHalfMinutes: value })} styles={styles} value={form.extraTimeHalfMinutes} /></> : null}
        <CoachDateTimeField label="Match date" mode="date" minimumDate={new Date()} onChange={(value) => setForm({ ...form, matchDate: value })} styles={styles} value={form.matchDate} />
        <Toggle label="Kick-off time to be confirmed" onValueChange={(value) => setForm({ ...form, arrivalTime: value ? '' : calculateCoachArrivalTime(form.kickoffTime, form.arrivalPreset), kickoffTimeTbc: value })} styles={styles} value={form.kickoffTimeTbc} />
        {!form.kickoffTimeTbc ? <CoachDateTimeField label="Kick-off time" mode="time" onChange={(value) => setForm(updateCoachFixtureKickoff(form, value))} styles={styles} value={form.kickoffTime} /> : null}
        {!form.kickoffTimeTbc ? <><Text style={styles.fieldLabel}>Arrival</Text><Chips onChange={(value) => setForm(updateCoachFixtureArrivalPreset(form, value))} options={COACH_MATCH_ARRIVAL_OPTIONS} styles={styles} value={form.arrivalPreset} />{form.arrivalPreset === 'custom' ? <CoachDateTimeField label="Arrival time" mode="time" onChange={(value) => setForm({ ...form, arrivalTime: value })} styles={styles} value={form.arrivalTime} /> : <Text style={styles.meta}>Arrival time: {form.arrivalTime || 'Set a kick-off time'}</Text>}<Toggle label="Save this arrival as my default" onValueChange={(value) => setForm({ ...form, saveArrivalAsDefault: value })} styles={styles} value={form.saveArrivalAsDefault} /></> : null}
        <Text style={styles.fieldLabel}>Home or away</Text>
        <Chips onChange={(value) => setForm({ ...form, homeAway: value })} options={MATCH_DAY_HOME_AWAY_OPTIONS} styles={styles} value={form.homeAway} />
        <Text style={styles.fieldLabel}>Kits</Text>
        <Chips onChange={(value) => setForm({ ...form, shirtChoice: value })} options={MATCH_DAY_SHIRT_CHOICE_OPTIONS} styles={styles} value={form.shirtChoice} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Clock</Text>
        <Chips onChange={(value) => setForm({ ...form, clockMode: value })} options={MATCH_CLOCK_MODE_OPTIONS} styles={styles} value={form.clockMode} />
        {!isContinuousMatchClock(form) ? <><Text style={styles.fieldLabel}>Match duration</Text><Chips onChange={(value) => setForm({ ...form, matchDurationMinutes: value })} options={[...COACH_MATCH_DURATION_OPTIONS.map((value) => ({ label: `${value} minutes`, value })), { label: 'Custom', value: 'custom' }]} styles={styles} value={durationIsCustom ? 'custom' : Number(form.matchDurationMinutes)} />{durationIsCustom ? <Field label="Custom duration, even minutes from 2 to 140" onChangeText={(value) => setForm({ ...form, matchDurationMinutes: value })} styles={styles} value={form.matchDurationMinutes === 'custom' ? '' : form.matchDurationMinutes} /> : null}<Toggle label="Save this duration as my default" onValueChange={(value) => setForm({ ...form, saveDurationAsDefault: value })} styles={styles} value={form.saveDurationAsDefault} /></> : <Text style={styles.meta}>The clock runs until a Coach pauses it or selects Full Time.</Text>}
      </View>

      <View onLayout={(event) => { locationSectionY.current = event.nativeEvent.layout.y }} style={styles.card}>
        <Text style={styles.cardTitle}>Location</Text>
        <Text style={styles.fieldLabel}>Pitch type</Text>
        <Chips onChange={(value) => setForm({ ...form, pitchType: value })} options={COACH_PITCH_TYPE_OPTIONS} styles={styles} value={form.pitchType} />
        {locations.length ? <><Text style={styles.fieldLabel}>Saved locations</Text><Chips onChange={selectLocation} options={locations.map((location) => ({ label: location.label, value: location.id }))} styles={styles} value={locationValue} /></> : null}
        {locationValue ? <Button disabled={busy} label="Delete saved address" onPress={confirmDeleteLocation} secondary styles={styles} /> : null}
        <Field label="Venue" onChangeText={(value) => setForm({ ...form, venueName: value })} styles={styles} value={form.venueName} />
        <Field label="Address" onChangeText={(value) => setForm({ ...form, venueAddress: value })} styles={styles} value={form.venueAddress} />
        <Text style={styles.meta}>Saved venues are offered first, and both fields remain editable.</Text>
      </View>

      {!isEditing ? <View style={styles.card}>
        <Text style={styles.cardTitle}>Players and Parents</Text>
        <Toggle label="Automatically select Players who respond Available" onValueChange={(value) => setForm({ ...form, autoSelectAvailablePlayers: value })} styles={styles} value={form.autoSelectAvailablePlayers} />
        <Toggle label="Share with parents" onValueChange={(value) => { selectionTouched.current = true; setForm({ ...form, parentAudience: value ? 'involved_players' : 'none', parentVisible: value, selectedPlayerIds: value ? eligiblePlayers.map((player) => player.id) : [] }) }} styles={styles} value={form.parentVisible} />
        {form.parentVisible ? <><Text style={styles.fieldLabel}>Parent audience</Text><Chips onChange={(value) => { selectionTouched.current = true; setForm({ ...form, parentAudience: value }) }} options={[{ label: 'Selected Players', value: 'involved_players' }, { label: 'Team parents', value: 'all_team_parents' }]} styles={styles} value={form.parentAudience} /><View style={styles.row}><Button label="Select all" onPress={() => { selectionTouched.current = true; setForm({ ...form, selectedPlayerIds: eligiblePlayers.map((player) => player.id) }) }} secondary styles={styles} /><Button label="Squad only" onPress={() => { selectionTouched.current = true; setForm({ ...form, selectedPlayerIds: eligiblePlayers.filter((player) => String(player.section || '').trim().toLowerCase() === 'squad').map((player) => player.id) }) }} secondary styles={styles} /><Button label="Clear" onPress={() => { selectionTouched.current = true; setForm({ ...form, selectedPlayerIds: [] }) }} secondary styles={styles} /></View>{eligiblePlayers.map((player) => { const selected = form.selectedPlayerIds.includes(player.id); return <Button key={player.id} label={`${selected ? 'Remove' : 'Add'} ${player.playerName}`} onPress={() => { selectionTouched.current = true; setForm({ ...form, selectedPlayerIds: selected ? form.selectedPlayerIds.filter((id) => id !== player.id) : [...form.selectedPlayerIds, player.id] }) }} secondary styles={styles} /> })}</> : null}
      </View> : null}

      {isEditing && ['scheduled', 'scorer_request'].includes(match.status) ? <View style={{ borderTopWidth: 1, borderTopColor: '#b9c6c4', paddingTop: 12, gap: 8 }}>
        <Text style={styles.sectionTitle}>Add parents to this fixture</Text>
        <Text style={styles.meta}>Choose players whose parents should receive this fixture. Existing invitations stay in place.</Text>
        {!parentInviteReady ? <Text style={styles.body}>Loading invited players...</Text> : eligiblePlayers.filter(player => !invitedPlayerIds.includes(player.id)).map(player => {
          const selected = newParentPlayerIds.includes(player.id)
          return <Pressable key={player.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setNewParentPlayerIds(current => selected ? current.filter(id => id !== player.id) : [...current, player.id])} style={styles.row}>
            <Text style={[styles.body, { flex: 1 }]}>{player.playerName}</Text><Text style={styles.body}>{selected ? 'Selected' : 'Add'}</Text>
          </Pressable>
        })}
        {parentInviteReady && eligiblePlayers.every(player => invitedPlayerIds.includes(player.id)) ? <Text style={styles.meta}>All eligible players are already invited.</Text> : null}
        <Button disabled={busy || !parentInviteReady || !newParentPlayerIds.length} label={`Add selected players and notify parents (${newParentPlayerIds.length})`} onPress={() => void addParents()} styles={styles} />
      </View> : null}

      {!isEditing ? <View style={styles.card}>
        <Text style={styles.cardTitle}>Optional match requests</Text>
        <View style={styles.row}><Text style={styles.fieldLabel}>Car pool</Text><Switch accessibilityLabel="Car pool" disabled={!carpoolReady || carpoolSaving} value={carpoolEnabled} onValueChange={changeCarpool} /></View>
        <Text style={styles.meta}>{carpoolSaving ? 'Saving team preference...' : carpoolLoadError ? 'Team default will be used when this match is saved. Car pool cannot be changed here.' : 'Saved for this team. New matches use this setting until you change it again.'}</Text>
        <Toggle label="Request scorer" onValueChange={(value) => setForm({ ...form, requestScorer: value })} styles={styles} value={form.requestScorer} />
        <Toggle label="Request linesman" onValueChange={(value) => setForm({ ...form, requestLinesman: value })} styles={styles} value={form.requestLinesman} />
        <Toggle label="Request referee" onValueChange={(value) => setForm({ ...form, requestReferee: value })} styles={styles} value={form.requestReferee} />
        <Toggle label="Create Player of the Match poll at full time" onValueChange={(value) => setForm({ ...form, enableMotmPoll: value, motmNotifyResultsOnClose: value ? form.motmNotifyResultsOnClose : false })} styles={styles} value={form.enableMotmPoll} />
        {form.enableMotmPoll ? <><Field autoCapitalize="none" label="Poll expiry (DD:HH:MM)" onChangeText={(value) => setForm({ ...form, motmPollExpiryDuration: value })} placeholder="00:02:00" styles={styles} value={form.motmPollExpiryDuration} /><Text style={styles.meta}>Days, hours, minutes. Minimum: 00:00:02. Example: 02:06:30.</Text><Toggle label="Save this vote expiry as my default" onValueChange={(value) => setForm({ ...form, saveMotmExpiryAsDefault: value })} styles={styles} value={form.saveMotmExpiryAsDefault} /><Toggle label="Send vote results" onValueChange={(value) => setForm({ ...form, motmNotifyResultsOnClose: value })} styles={styles} value={form.motmNotifyResultsOnClose} /><Text style={styles.meta}>Eligible parents are notified when the vote closes, expires, or everyone has replied.</Text></> : null}
        <Field label="Match notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} />
      </View> : <View style={styles.card}><Field label="Match notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} /><Text style={styles.meta}>Editing fixture details does not send a new availability request.</Text></View>}
      {isEditing ? <View style={styles.card}><View style={styles.row}><Text style={styles.fieldLabel}>Car pool</Text><Switch accessibilityLabel="Car pool" disabled={!carpoolReady || carpoolSaving} value={carpoolEnabled} onValueChange={changeCarpool} /></View><Text style={styles.meta}>{carpoolLoadError || 'Saved as the team default for future matches. Save fixture changes to apply it to this match.'}</Text></View> : null}
      {error ? <View accessibilityRole="alert" style={styles.warning}><Text style={styles.dangerText}>{error}</Text></View> : null}
      <Button disabled={busy || carpoolSaving} label={busy ? (isEditing ? 'Saving fixture...' : 'Creating fixture...') : (isEditing ? 'Save fixture changes' : 'Create fixture and request availability')} onPress={save} styles={styles} />
      {!isEditing ? <Button disabled={busy || carpoolSaving} label="Add to Coach calendars" onPress={() => save({ calendarTarget: 'coach' })} secondary styles={styles} /> : null}
      {!isEditing ? <Button disabled={busy || carpoolSaving || !hasEligiblePlayers} label="Add to player calendars" onPress={() => save({ calendarTarget: 'squad' })} secondary styles={styles} /> : null}
      <Button disabled={busy} label={isEditing ? 'Back without saving' : 'Cancel'} onPress={onCancel} secondary styles={styles} />
      {isEditing && showCancellation ? <Field label="Cancellation reason (optional)" multiline onChangeText={setCancellationReason} styles={styles} value={cancellationReason} /> : null}
      {isEditing ? <Pressable accessibilityRole="button" accessibilityLabel="Cancel fixture" accessibilityState={{ disabled: busy || carpoolSaving }} disabled={busy || carpoolSaving} onPress={() => showCancellation ? confirmCancelFixture() : setShowCancellation(true)} style={({ pressed }) => [styles.compactAction, (busy || carpoolSaving) && styles.actionDisabled, pressed && { opacity: 0.74 }]}><Text style={styles.dangerText}>Cancel fixture</Text></Pressable> : null}
    </View>
  )
}
