import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Pressable, Text, TextInput, View } from 'react-native'
import { DEFAULT_TEAM_KIT_COLOURS, hexToHsv, hsvToHex, mergeTeamKits, normalizeKitColour } from '../../../src/lib/team-kits.js'
import { loadMobileClubKits, setMobileTeamKits } from '../../mobile-core/src/mobileKitCache'
import { getCoachTeamKits, saveCoachTeamKits } from '../../mobile-core/src/coachTeamKitsData'

const COLOURS = ['#ffffff', '#111827', '#dc2626', '#f97316', '#facc15', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777']
const STEPS = Array.from({ length: 24 }, (_, index) => index / 23)

function ColourChannel({ caption, label, onChange, palette, renderColour, value }) {
  const [width, setWidth] = useState(1)
  const trackRef = useRef(null)
  const trackLeftRef = useRef(0)
  const measureTrack = event => {
    setWidth(Math.max(1, event.nativeEvent.layout.width))
    if (typeof trackRef.current?.getBoundingClientRect === 'function') {
      trackLeftRef.current = trackRef.current.getBoundingClientRect().left
    } else {
      trackRef.current?.measureInWindow?.((left) => { trackLeftRef.current = left })
    }
  }
  const setFromEvent = event => {
    const nativeEvent = event.nativeEvent || {}
    const absolute = Number(nativeEvent.pageX ?? nativeEvent.clientX)
    const location = Number.isFinite(absolute) ? absolute - trackLeftRef.current : Number(nativeEvent.locationX)
    if (Number.isFinite(location)) onChange(Math.max(0, Math.min(1, location / width)))
  }
  return <View style={{ gap: 4 }}>
    <Text style={{ color: palette.textSecondary, fontSize: 12, fontWeight: '600' }}>{caption}</Text>
    <Pressable ref={trackRef} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} accessibilityLabel={label} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }} onAccessibilityAction={({ nativeEvent }) => onChange(Math.max(0, Math.min(1, value + (nativeEvent.actionName === 'increment' ? 0.05 : -0.05))))} onLayout={measureTrack} onMoveShouldSetResponder={() => true} onPress={setFromEvent} onPressIn={setFromEvent} onResponderMove={setFromEvent} style={{ flexDirection: 'row', height: 44, position: 'relative' }}>
      {STEPS.map(step => <View key={step} pointerEvents="none" style={{ backgroundColor: renderColour(step), flex: 1 }} />)}
      <View pointerEvents="none" style={{ borderColor: '#ffffff', borderRadius: 4, borderWidth: 2, bottom: 0, left: `${Math.round(value * 100)}%`, position: 'absolute', top: 0, transform: [{ translateX: -3 }], width: 6 }} />
    </Pressable>
  </View>
}

function ContinuousColourPicker({ hsv, label, onChange, palette }) {
  return <View style={{ gap: 8 }}>
    <Text style={{ color: palette.textPrimary, fontWeight: '600' }}>Colour picker</Text>
    <ColourChannel caption="Hue" label={`${label} hue`} palette={palette} value={hsv.h / 360} onChange={value => onChange({ ...hsv, h: value * 359 })} renderColour={value => hsvToHex({ h: value * 359, s: 1, v: 1 })} />
    <ColourChannel caption="Saturation" label={`${label} saturation`} palette={palette} value={hsv.s} onChange={value => onChange({ ...hsv, s: value })} renderColour={value => hsvToHex({ ...hsv, s: value })} />
    <ColourChannel caption="Brightness" label={`${label} brightness`} palette={palette} value={hsv.v} onChange={value => onChange({ ...hsv, v: value })} renderColour={value => hsvToHex({ ...hsv, v: value })} />
  </View>
}

function KitColourRow({ canEdit, colour, label, onChange, palette }) {
  const [hsv, setHsv] = useState(() => hexToHsv(colour))
  const selectColour = value => {
    const normalized = normalizeKitColour(value)
    if (normalized) {
      const next = hexToHsv(normalized)
      setHsv(current => next.s === 0 ? { ...next, h: current.h } : next)
    }
    onChange(value)
  }
  const selectHsv = next => {
    setHsv(next)
    onChange(hsvToHex(next))
  }
  return <View style={{ borderTopColor: palette.border, borderTopWidth: 1, gap: 10, paddingVertical: 14 }}>
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}>
      <Image accessible={false} source={require('../../mobile-core/assets/formation-shirt-white.png')} resizeMode="contain" style={{ height: 58, tintColor: colour.toLowerCase() === '#ffffff' ? undefined : colour, width: 58 }} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: palette.textPrimary, fontSize: 16, fontWeight: '700' }}>{label}</Text>
        <TextInput accessibilityLabel={`${label} hex colour`} autoCapitalize="none" autoCorrect={false} editable={canEdit} maxLength={7} onChangeText={selectColour} placeholder="#1d4ed8" placeholderTextColor={palette.textMuted} style={{ borderBottomColor: palette.border, borderBottomWidth: 1, color: palette.textPrimary, minHeight: 44, paddingVertical: 8 }} value={colour} />
      </View>
    </View>
    {canEdit ? <View accessibilityLabel={`${label} colour picker`} accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {COLOURS.map(option => <Pressable key={option} accessibilityLabel={`${label} ${option}`} accessibilityRole="radio" accessibilityState={{ checked: option === colour.toLowerCase() }} onPress={() => selectColour(option)} style={{ alignItems: 'center', borderColor: option === colour.toLowerCase() ? palette.textPrimary : palette.border, borderRadius: 22, borderWidth: 2, height: 44, justifyContent: 'center', width: 44 }}>
        <View style={{ backgroundColor: option, borderColor: '#8a9891', borderRadius: 15, borderWidth: option === '#ffffff' ? 1 : 0, height: 30, width: 30 }} />
      </Pressable>)}
    </View> : null}
    {canEdit ? <ContinuousColourPicker hsv={hsv} label={label} onChange={selectHsv} palette={palette} /> : null}
  </View>
}

export function CoachTeamKitSettings({ palette, user }) {
  const [colours, setColours] = useState(DEFAULT_TEAM_KIT_COLOURS)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const operationRef = useRef(0)
  const savingRef = useRef(false)
  const canEdit = Number(user?.roleRank || 0) >= 50 && user?.hasActivePlanAccess === true
  const canInteract = canEdit && !loadFailed && status !== 'saving'

  const load = useCallback(async (isRetry = false) => {
    const operation = ++operationRef.current
    if (isRetry) setStatus('loading')
    setMessage('')
    try {
      const [teamKits, clubKits] = await Promise.all([getCoachTeamKits(user), loadMobileClubKits(user.clubId)])
      if (operation !== operationRef.current) return
      const kits = mergeTeamKits(teamKits, clubKits)
      setColours({
        home: kits.home?.colour || DEFAULT_TEAM_KIT_COLOURS.home,
        away: kits.away?.colour || DEFAULT_TEAM_KIT_COLOURS.away,
      })
      setLoadFailed(false)
      setStatus('ready')
    } catch {
      if (operation !== operationRef.current) return
      setLoadFailed(true)
      setMessage('Kit colours could not be loaded. Try again before making changes.')
      setStatus('error')
    }
  }, [user])
  useEffect(() => {
    void load(false)
    return () => { operationRef.current += 1; savingRef.current = false }
  }, [load])

  const update = (type, value) => setColours(current => ({ ...current, [type]: value }))
  const save = async () => {
    if (savingRef.current || loadFailed) return
    savingRef.current = true
    const operation = ++operationRef.current
    setMessage('')
    setStatus('saving')
    try {
      const kits = await saveCoachTeamKits(user, {
        home: { colour: normalizeKitColour(colours.home) || colours.home },
        away: { colour: normalizeKitColour(colours.away) || colours.away },
      })
      if (operation !== operationRef.current) return
      setMobileTeamKits(user.clubId, user.activeTeamId, kits)
      setColours({ home: kits.home.colour, away: kits.away.colour })
      setMessage('Team kit colours saved.')
      setStatus('ready')
    } catch (error) {
      if (operation !== operationRef.current) return
      setMessage(error?.message || 'Kit colours could not be saved.')
      setStatus('error')
    } finally {
      if (operation === operationRef.current) savingRef.current = false
    }
  }

  return <View style={{ gap: 2 }}>
    <Text style={{ color: palette.textSecondary, lineHeight: 20 }}>Choose the shirts shown for this team in Matchday. Your club's current kit stays in use until team colours are saved.</Text>
    {status === 'loading' ? <Text accessibilityLiveRegion="polite" style={{ color: palette.textSecondary, lineHeight: 20 }}>Loading team kit colours...</Text> : <>
      <KitColourRow canEdit={canInteract} colour={colours.home} label="Home kit" onChange={value => update('home', value)} palette={palette} />
      <KitColourRow canEdit={canInteract} colour={colours.away} label="Away kit" onChange={value => update('away', value)} palette={palette} />
    </>}
    {!canEdit ? <Text style={{ color: palette.textSecondary, lineHeight: 20 }}>A Team Manager or Club Admin can change these colours.</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: status === 'error' ? palette.danger : palette.textPrimary, lineHeight: 20 }}>{message}</Text> : null}
    {loadFailed ? <Pressable accessibilityRole="button" onPress={() => load(true)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: palette.accent, fontWeight: '700' }}>Retry loading kit colours</Text></Pressable> : null}
    {canEdit && !loadFailed ? <Pressable accessibilityRole="button" disabled={status === 'loading' || status === 'saving'} onPress={save} style={({ pressed }) => ({ alignItems: 'center', alignSelf: 'flex-start', backgroundColor: palette.accent, borderRadius: 8, justifyContent: 'center', minHeight: 44, opacity: pressed || status === 'saving' ? 0.7 : 1, paddingHorizontal: 18 })}>
      <Text style={{ color: palette.accentForeground, fontWeight: '700' }}>{status === 'saving' ? 'Saving...' : 'Save kit colours'}</Text>
    </Pressable> : null}
  </View>
}
