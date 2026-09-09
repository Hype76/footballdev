import { useEffect, useRef, useState } from 'react'
import { Image, Linking, Platform, Pressable, Text, View } from 'react-native'
import { findVenuePlaces, MAP_ATTRIBUTION_URL, MAP_USER_AGENT, venueMapTiles } from './venueMapCore'

export function VenueMapPreview({ location, offline = false, colors = {}, styles = {} }) {
  const [state, setState] = useState({ status: 'idle', places: [], selected: null })
  const [zoom, setZoom] = useState(15)
  const [width, setWidth] = useState(280)
  const [tileError, setTileError] = useState(false)
  const request = useRef(null)
  useEffect(() => () => request.current?.abort(), [])
  const search = async () => {
    if (offline || request.current) return
    const controller = new AbortController(); request.current = controller
    const timeout = setTimeout(() => controller.abort(), 12000)
    setState({ status: 'loading', places: [], selected: null })
    try {
      const places = await findVenuePlaces(location, controller.signal)
      setState({ status: places.length ? 'ready' : 'empty', places, selected: places.length === 1 ? places[0] : null })
    } catch { setState({ status: 'error', places: [], selected: null }) }
    finally { clearTimeout(timeout); request.current = null }
  }
  const textColor = colors.textPrimary || colors.text || '#172d2d'
  const accent = colors.accentText || colors.accent || '#166575'
  const button = (label, onPress, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={event => { event.stopPropagation?.(); onPress() }} style={{ minHeight: 44, padding: 8, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}><Text style={[styles.body, { color: accent }]}>{label}</Text></Pressable>
  if (!location) return null
  return <View style={{ gap: 6 }}>
    {state.status === 'idle' || state.status === 'loading' || state.status === 'error' || state.status === 'empty' ? button(state.status === 'loading' ? 'Finding venue...' : 'Preview venue map', () => void search(), offline || state.status === 'loading') : null}
    {offline ? <Text style={[styles.meta, { color: textColor }]}>Connect to preview the venue map.</Text> : null}
    {['empty', 'error'].includes(state.status) ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: textColor }]}>A map preview is unavailable for this address. Use Get directions to check the venue.</Text> : null}
    {state.places.length > 1 ? <View><Text style={[styles.body, { color: textColor }]}>Choose the matching venue:</Text>{state.places.map((place, index) => <View key={index}>{button(place.label, () => { setTileError(false); setState(current => ({ ...current, selected: place })) })}</View>)}</View> : null}
    {state.selected ? <View style={{ gap: 6 }}>
      <Text style={[styles.meta, { color: textColor }]}>Approximate map location: {state.selected.label}. Check the event address before travelling.</Text>
      <View accessibilityLabel="Venue map preview" onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))} style={{ height: 220, overflow: 'hidden', borderRadius: 12, backgroundColor: '#e6eadf' }}>
        {!offline && !tileError ? venueMapTiles(state.selected, zoom, width).map(tile => <Image key={tile.key} accessible={false} onError={() => setTileError(true)} source={{ uri: tile.url, ...(Platform.OS === 'web' ? {} : { headers: { 'User-Agent': MAP_USER_AGENT }, cache: 'default' }) }} style={{ position: 'absolute', width: 256, height: 256, left: tile.left, top: tile.top }} />) : null}
        {tileError || offline ? <Text style={{ padding: 20, color: '#172d2d' }}>Map tiles unavailable. Use Get directions.</Text> : <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -9, marginTop: -9, width: 18, height: 18, backgroundColor: '#c62626', borderColor: 'white', borderWidth: 3, borderRadius: 9 }} />}
        <Pressable accessibilityRole="link" onPress={event => { event.stopPropagation?.(); void Linking.openURL(MAP_ATTRIBUTION_URL).catch(() => {}) }} style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: '#ffffffee', padding: 6 }}><Text style={{ color: '#172d2d', fontSize: 11 }}>© OpenStreetMap contributors</Text></Pressable>
      </View>
      <View style={{ flexDirection: 'row' }}>{button('Zoom in', () => { setTileError(false); setZoom(value => value + 1) }, zoom >= 17 || offline)}{button('Zoom out', () => { setTileError(false); setZoom(value => value - 1) }, zoom <= 11 || offline)}{button('Close map', () => setState({ status: 'idle', places: [], selected: null }))}</View>
    </View> : null}
  </View>
}
