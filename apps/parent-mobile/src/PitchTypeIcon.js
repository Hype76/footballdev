import { Image, Text, View } from 'react-native'
import { normalizePitchType } from '../../../src/lib/pitch-type.js'

// Display the supplied artwork as a sprite, preserving the original six icons.
const source = require('../assets/pitch-types.png')
const artwork = {
  '4g': { label: '4G', left: 76, top: 136 },
  '3g': { label: '3G', left: 439, top: 136 },
  grass: { label: 'Grass', left: 801, top: 136 },
  astro: { label: 'Astro', left: 76, top: 424 },
  indoor: { label: 'Indoor', left: 439, top: 424 },
  other: { label: 'Other', left: 801, top: 424 },
}

export function PitchTypeIcon({ pitchType, textStyle }) {
  const icon = artwork[normalizePitchType(pitchType)]
  const scale = 88 / 325
  return (
    <View accessible accessibilityLabel={`Surface: ${icon?.label || 'Not specified'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      {icon ? <View testID={`pitch-type-${normalizePitchType(pitchType)}`} style={{ width: 88, height: 213 * scale, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
        <Image accessible={false} source={source} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', width: 1272 * scale, height: 831 * scale, left: -icon.left * scale, top: -icon.top * scale }} />
      </View> : null}
      <Text style={[textStyle, { flexShrink: 1 }]}>{`Surface: ${icon?.label || 'Not specified'}`}</Text>
    </View>
  )
}
