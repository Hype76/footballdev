import { useEffect, useMemo, useState } from 'react'
import { Keyboard, Pressable, Switch, Text, TextInput, View } from 'react-native'
import {
  calculateCoachArrivalTime,
  COACH_MATCH_ARRIVAL_OPTIONS,
  COACH_MATCH_DURATION_OPTIONS,
  getCoachMatchLocationOptions,
  initializeCoachFixtureForm,
  isContinuousMatchClock,
  MATCH_CLOCK_MODE_OPTIONS,
  MATCH_DAY_CONCLUSION_RULE_OPTIONS,
  MATCH_DAY_EXTRA_TIME_PERIOD_COUNT_OPTIONS,
  MATCH_DAY_FIXTURE_TYPE_OPTIONS,
  MATCH_DAY_HOME_AWAY_OPTIONS,
  matchUsesExtraTime,
  updateCoachFixtureArrivalPreset,
  updateCoachFixtureKickoff,
} from '../../mobile-core/src/coachFixtureCore.js'
import { createCoachMatchDayFixture } from '../../mobile-core/src/coachMatchDayData.js'
import { CoachDateTimeField } from './CoachDateTimeField'
import { readCoachFixturePreferences, writeCoachFixturePreferences } from './coachFixturePreferences'
import { getCoachFriendlyError } from './coachFriendlyErrors'

function Button({ disabled = false, label, onPress, secondary = false, styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [secondary ? styles.secondary : styles.action, disabled && styles.actionDisabled, pressed && { opacity: 0.74 }]}><Text style={secondary ? styles.secondaryText : styles.actionText}>{label}</Text></Pressable>
}

function Chips({ onChange, options, styles, value }) {
  return <View style={styles.tabs}>{options.map((option) => { const selected = value === option.value; return <Pressable accessibilityRole="button" accessibilityState={{ selected }} key={String(option.value)} onPress={() => onChange(option.value)} style={[styles.chip, selected && styles.chipActive]}><Text style={[styles.chipText, selected && styles.chipTextActive]}>{option.label}</Text></Pressable> })}</View>
}

function Field({ label, multiline = false, onChangeText, styles, value }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} multiline={multiline} onChangeText={onChangeText} style={[styles.input, multiline && styles.inputMultiline]} value={String(value ?? '')} /></View>
}

function Toggle({ label, onValueChange, styles, value }) {
  return <View style={styles.row}><Text style={styles.fieldLabel}>{label}</Text><Switch accessibilityLabel={label} onValueChange={onValueChange} value={value === true} /></View>
}

export function CoachFixtureForm({ matches, onCancel, onCreated, players, styles, user }) {
  const locations = useMemo(() => getCoachMatchLocationOptions(matches), [matches])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fallbackLocation = useMemo(() => locations[0] || null, [locations])

  useEffect(() => {
    let active = true
    void readCoachFixturePreferences(user.id, user.activeTeamId).then((preferences) => {
      if (!active) return
      const savedLocation = preferences.location?.name ? preferences.location : fallbackLocation
      setForm((current) => initializeCoachFixtureForm(current, { defaultDuration: preferences.duration, defaultLocation: savedLocation }))
    })
    return () => { active = false }
  }, [fallbackLocation, user.activeTeamId, user.id])

  if (!form) return <View style={styles.card}><Text style={styles.body}>Preparing fixture setup...</Text></View>

  const save = async () => {
    Keyboard.dismiss()
    setBusy(true)
    setError('')
    const submittedForm = {
      ...form,
      selectedPlayerIds: [...form.selectedPlayerIds],
    }
    try {
      const result = await createCoachMatchDayFixture(user, submittedForm)
      await writeCoachFixturePreferences(user.id, user.activeTeamId, {
        duration: submittedForm.saveDurationAsDefault ? submittedForm.matchDurationMinutes : (await readCoachFixturePreferences(user.id, user.activeTeamId)).duration,
        location: submittedForm.venueName ? { address: submittedForm.venueAddress, name: submittedForm.venueName } : null,
      })
      onCreated(result)
    } catch (saveError) {
      setError(getCoachFriendlyError(saveError, 'The fixture could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  const selectLocation = (id) => {
    const location = locations.find((item) => item.id === id)
    if (location) setForm({ ...form, venueAddress: location.address, venueName: location.name })
  }
  const locationValue = locations.find((item) => item.name === form.venueName && item.address === form.venueAddress)?.id || ''
  const durationIsCustom = !COACH_MATCH_DURATION_OPTIONS.includes(Number(form.matchDurationMinutes))

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create match</Text>
        <Text style={styles.body}>Create the full Match Day fixture first. Squad and live controls remain available after it is saved.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Fixture</Text>
        <Field label="Opponent" onChangeText={(value) => setForm({ ...form, opponent: value })} styles={styles} value={form.opponent} />
        <Text style={styles.fieldLabel}>Fixture type</Text>
        <Chips onChange={(value) => setForm({ ...form, fixtureType: value })} options={MATCH_DAY_FIXTURE_TYPE_OPTIONS} styles={styles} value={form.fixtureType} />
        <Text style={styles.fieldLabel}>How this match can finish</Text>
        <Chips onChange={(value) => setForm({ ...form, conclusionRule: value })} options={MATCH_DAY_CONCLUSION_RULE_OPTIONS} styles={styles} value={form.conclusionRule} />
        {matchUsesExtraTime(form) ? <><Text style={styles.fieldLabel}>Extra-time periods</Text><Chips onChange={(value) => setForm({ ...form, extraTimePeriodCount: value })} options={MATCH_DAY_EXTRA_TIME_PERIOD_COUNT_OPTIONS} styles={styles} value={form.extraTimePeriodCount} /><Field label="Extra-time period minutes" onChangeText={(value) => setForm({ ...form, extraTimeHalfMinutes: value })} styles={styles} value={form.extraTimeHalfMinutes} /></> : null}
        <CoachDateTimeField label="Match date" mode="date" minimumDate={new Date()} onChange={(value) => setForm({ ...form, matchDate: value })} styles={styles} value={form.matchDate} />
        <Toggle label="Kick-off time to be confirmed" onValueChange={(value) => setForm({ ...form, arrivalTime: value ? '' : calculateCoachArrivalTime(form.kickoffTime, form.arrivalPreset), kickoffTimeTbc: value })} styles={styles} value={form.kickoffTimeTbc} />
        {!form.kickoffTimeTbc ? <CoachDateTimeField label="Kick-off time" mode="time" onChange={(value) => setForm(updateCoachFixtureKickoff(form, value))} styles={styles} value={form.kickoffTime} /> : null}
        {!form.kickoffTimeTbc ? <><Text style={styles.fieldLabel}>Arrival</Text><Chips onChange={(value) => setForm(updateCoachFixtureArrivalPreset(form, value))} options={COACH_MATCH_ARRIVAL_OPTIONS} styles={styles} value={form.arrivalPreset} />{form.arrivalPreset === 'custom' ? <CoachDateTimeField label="Arrival time" mode="time" onChange={(value) => setForm({ ...form, arrivalTime: value })} styles={styles} value={form.arrivalTime} /> : <Text style={styles.meta}>Arrival time: {form.arrivalTime || 'Set a kick-off time'}</Text>}</> : null}
        <Text style={styles.fieldLabel}>Home or away</Text>
        <Chips onChange={(value) => setForm({ ...form, homeAway: value })} options={MATCH_DAY_HOME_AWAY_OPTIONS} styles={styles} value={form.homeAway} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Clock</Text>
        <Chips onChange={(value) => setForm({ ...form, clockMode: value })} options={MATCH_CLOCK_MODE_OPTIONS} styles={styles} value={form.clockMode} />
        {!isContinuousMatchClock(form) ? <><Text style={styles.fieldLabel}>Match duration</Text><Chips onChange={(value) => setForm({ ...form, matchDurationMinutes: value })} options={[...COACH_MATCH_DURATION_OPTIONS.map((value) => ({ label: `${value} minutes`, value })), { label: 'Custom', value: 'custom' }]} styles={styles} value={durationIsCustom ? 'custom' : Number(form.matchDurationMinutes)} />{durationIsCustom ? <Field label="Custom duration, even minutes from 20 to 140" onChangeText={(value) => setForm({ ...form, matchDurationMinutes: value })} styles={styles} value={form.matchDurationMinutes === 'custom' ? '' : form.matchDurationMinutes} /> : null}<Toggle label="Save this duration as my default" onValueChange={(value) => setForm({ ...form, saveDurationAsDefault: value })} styles={styles} value={form.saveDurationAsDefault} /></> : <Text style={styles.meta}>The clock runs until a Coach pauses it or selects Full Time.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Location</Text>
        {locations.length ? <><Text style={styles.fieldLabel}>Saved locations</Text><Chips onChange={selectLocation} options={locations.map((location) => ({ label: location.label, value: location.id }))} styles={styles} value={locationValue} /></> : null}
        <Field label="Venue" onChangeText={(value) => setForm({ ...form, venueName: value })} styles={styles} value={form.venueName} />
        <Field label="Address" onChangeText={(value) => setForm({ ...form, venueAddress: value })} styles={styles} value={form.venueAddress} />
        <Text style={styles.meta}>Saved venues are offered first, and both fields remain editable.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Players and Parents</Text>
        <Toggle label="Automatically select Players who respond Available" onValueChange={(value) => setForm({ ...form, autoSelectAvailablePlayers: value })} styles={styles} value={form.autoSelectAvailablePlayers} />
        <Toggle label="Share with parents" onValueChange={(value) => setForm({ ...form, parentAudience: value ? 'involved_players' : 'none', parentVisible: value, selectedPlayerIds: value ? players.map((player) => player.id) : [] })} styles={styles} value={form.parentVisible} />
        {form.parentVisible ? <><Text style={styles.fieldLabel}>Parent audience</Text><Chips onChange={(value) => setForm({ ...form, parentAudience: value })} options={[{ label: 'Selected Players', value: 'involved_players' }, { label: 'Team parents', value: 'all_team_parents' }]} styles={styles} value={form.parentAudience} /><View style={styles.row}><Button label="Select all" onPress={() => setForm({ ...form, selectedPlayerIds: players.map((player) => player.id) })} secondary styles={styles} /><Button label="Clear" onPress={() => setForm({ ...form, selectedPlayerIds: [] })} secondary styles={styles} /></View>{players.map((player) => { const selected = form.selectedPlayerIds.includes(player.id); return <Button key={player.id} label={`${selected ? 'Remove' : 'Add'} ${player.playerName}`} onPress={() => setForm({ ...form, selectedPlayerIds: selected ? form.selectedPlayerIds.filter((id) => id !== player.id) : [...form.selectedPlayerIds, player.id] })} secondary styles={styles} /> })}</> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Optional match requests</Text>
        <Toggle label="Request scorer" onValueChange={(value) => setForm({ ...form, requestScorer: value })} styles={styles} value={form.requestScorer} />
        <Toggle label="Request linesman" onValueChange={(value) => setForm({ ...form, requestLinesman: value })} styles={styles} value={form.requestLinesman} />
        <Toggle label="Request referee" onValueChange={(value) => setForm({ ...form, requestReferee: value })} styles={styles} value={form.requestReferee} />
        <Toggle label="Create Player of the Match poll at full time" onValueChange={(value) => setForm({ ...form, enableMotmPoll: value, motmNotifyResultsOnClose: value ? form.motmNotifyResultsOnClose : false })} styles={styles} value={form.enableMotmPoll} />
        {form.enableMotmPoll ? <><Field label="Poll expiry hours" onChangeText={(value) => setForm({ ...form, motmPollExpiryHours: value })} styles={styles} value={form.motmPollExpiryHours} /><Toggle label="Send vote results" onValueChange={(value) => setForm({ ...form, motmNotifyResultsOnClose: value })} styles={styles} value={form.motmNotifyResultsOnClose} /><Text style={styles.meta}>Eligible parents are notified when the vote closes, expires, or everyone has replied.</Text></> : null}
        <Field label="Match notes" multiline onChangeText={(value) => setForm({ ...form, notes: value })} styles={styles} value={form.notes} />
      </View>
      {error ? <View accessibilityRole="alert" style={styles.warning}><Text style={styles.dangerText}>{error}</Text></View> : null}
      <Button disabled={busy} label={busy ? 'Creating fixture...' : 'Create fixture'} onPress={save} styles={styles} />
      <Button disabled={busy} label="Cancel" onPress={onCancel} secondary styles={styles} />
    </View>
  )
}
