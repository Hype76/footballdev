import { Image, Text, View } from 'react-native'
import { getParentMatchResult } from './matchResult.js'

const icons = { won: require('../../mobile-core/assets/won.png'), loss: require('../../mobile-core/assets/loss.png'), draw: require('../../mobile-core/assets/draw.png') }
const labels = { won: 'Won', loss: 'Loss', draw: 'Draw' }
export function MatchResultIcon({ match, textStyle }) {
  const result = getParentMatchResult(match)
  if (!result) return null
  return <View accessible accessibilityLabel={`Match result: ${labels[result]}`} style={{ alignItems: 'center', width: 44 }}>
    <Image accessible={false} source={icons[result]} resizeMode="contain" style={{ width: 44, height: 44 }} />
    <Text style={[textStyle, { fontSize: 11, fontWeight: '700' }]}>{labels[result]}</Text>
  </View>
}
