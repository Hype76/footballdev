import { Image } from 'react-native'

const wave = require('../assets/club-feature-wave.png')

export function ClubFeatureWave({ color }) {
  return <Image accessible={false} pointerEvents="none" resizeMode="stretch" source={wave}
    style={{ bottom: -5, height: 76, opacity: 0.1, position: 'absolute', right: 0, tintColor: color, width: '100%' }} />
}
