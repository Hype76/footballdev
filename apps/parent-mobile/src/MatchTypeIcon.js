import { Image, Text, View } from 'react-native'
import { normalizeMatchDayFixtureType } from '../../../src/lib/matchday-fixture-type.js'

const source = require('../assets/match-types.png')
const artwork = {
  league: { label: 'League', left: 50 },
  cup: { label: 'Cup', left: 436 },
  tournament: { label: 'Tournament', left: 825 },
  friendly: { label: 'Friendly', left: 1212 },
}

export function MatchTypeIcon({ fixtureType, textStyle, compact = false }) {
  const type = normalizeMatchDayFixtureType(fixtureType)
  const icon = artwork[type]
  const label = icon?.label || 'Not specified'
  const size = compact ? 40 : 56
  const scale = size / 344
  return (
    <View accessible accessibilityLabel={`Match type: ${label}`} style={{ flexDirection: compact ? 'column' : 'row', alignItems: 'center', gap: compact ? 4 : 12, paddingVertical: 6, ...(compact ? { flex: 1, minWidth: 0 } : {}) }}>
      {icon ? <View testID={`match-type-${type}`} style={{ width: size, height: size, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
        <Image accessible={false} source={source} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', width: 1600 * scale, height: 800 * scale, left: -icon.left * scale, top: -178 * scale }} />
      </View> : compact ? <View style={{ height: size }} /> : null}
      <Text style={[textStyle, { flexShrink: 1 }, compact && { fontSize: 12, textAlign: 'center' }]}>{compact ? label : `Match type: ${label}`}</Text>
    </View>
  )
}
