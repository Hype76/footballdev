import { Image, Text, View } from 'react-native'

const source = require('../assets/home-away.png')
const locations = {
  home: { label: 'Home game', offset: 0 },
  away: { label: 'Away game', offset: 56 },
}

export function HomeAwayIcon({ homeAway, textStyle }) {
  const location = String(homeAway || '').trim().toLowerCase()
  const icon = locations[location]
  if (!icon) return homeAway ? <Text style={textStyle}>{location === 'neutral' ? 'Neutral venue' : 'Venue type not specified'}</Text> : null
  return (
    <View accessible accessibilityLabel={icon.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      <View testID={`home-away-${location}`} style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
        <Image accessible={false} source={source} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', width: 112, height: 56, left: -icon.offset, top: 0 }} />
      </View>
      <Text style={[textStyle, { flexShrink: 1 }]}>{icon.label}</Text>
    </View>
  )
}
