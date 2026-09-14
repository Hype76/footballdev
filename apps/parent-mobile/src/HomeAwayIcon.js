import { Image, Text, View } from 'react-native'

const source = require('../assets/home-away.png')
const locations = {
  home: { label: 'Home game', offset: 0 },
  away: { label: 'Away game', offset: 56 },
}

export function HomeAwayIcon({ homeAway, textStyle, compact = false }) {
  const location = String(homeAway || '').trim().toLowerCase()
  const icon = locations[location]
  const size = compact ? 40 : 56
  if (!icon) {
    const label = location === 'neutral' ? 'Neutral venue' : 'Venue type not specified'
    if (compact) return <View accessible accessibilityLabel={label} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingVertical: 6 }}>
      <View style={{ height: size, justifyContent: 'center' }}><Text style={textStyle}>?</Text></View>
      <Text style={[textStyle, { fontSize: 12, textAlign: 'center' }]}>{location === 'neutral' ? 'Neutral venue' : 'Venue TBC'}</Text>
    </View>
    return homeAway ? <Text style={textStyle}>{label}</Text> : null
  }
  return (
    <View accessible accessibilityLabel={icon.label} style={{ flexDirection: compact ? 'column' : 'row', alignItems: 'center', gap: compact ? 4 : 12, paddingVertical: 6, ...(compact ? { flex: 1, minWidth: 0 } : {}) }}>
      <View testID={`home-away-${location}`} style={{ width: size, height: size, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
        <Image accessible={false} source={source} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', width: size * 2, height: size, left: -icon.offset * size / 56, top: 0 }} />
      </View>
      <Text style={[textStyle, { flexShrink: 1 }, compact && { fontSize: 12, textAlign: 'center' }]}>{icon.label}</Text>
    </View>
  )
}
