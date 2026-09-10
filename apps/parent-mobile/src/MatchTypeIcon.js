import { Image, Text, View } from 'react-native'
import { normalizeMatchDayFixtureType } from '../../../src/lib/matchday-fixture-type.js'

const source = require('../assets/match-types.png')
const artwork = {
  league: { label: 'League', left: 50 },
  cup: { label: 'Cup', left: 436 },
  tournament: { label: 'Tournament', left: 825 },
  friendly: { label: 'Friendly', left: 1212 },
}

export function MatchTypeIcon({ fixtureType, textStyle }) {
  const type = normalizeMatchDayFixtureType(fixtureType)
  const icon = artwork[type]
  const label = icon?.label || 'Not specified'
  const scale = 56 / 344
  return (
    <View accessible accessibilityLabel={`Match type: ${label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      {icon ? <View testID={`match-type-${type}`} style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
        <Image accessible={false} source={source} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', width: 1600 * scale, height: 800 * scale, left: -icon.left * scale, top: -178 * scale }} />
      </View> : null}
      <Text style={[textStyle, { flexShrink: 1 }]}>{`Match type: ${label}`}</Text>
    </View>
  )
}
