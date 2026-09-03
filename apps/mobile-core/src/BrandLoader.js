import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, View } from 'react-native'

const logoSource = require('../assets/football-player-logo.png')
// Frame just the round FP emblem within the existing 512px app artwork.
const emblem = { diameter: 276, left: 118, top: 66, sourceSize: 512 }

export function BrandLoader({ accessibilityLabel = 'Loading', accessible = true, size = 'small', style }) {
  const diameter = typeof size === 'number' && Number.isFinite(size) && size > 0
    ? size
    : size === 'large' ? 56 : 28
  const scale = diameter / emblem.diameter
  const [rotation] = useState(() => new Animated.Value(0))
  const [reduceMotion, setReduceMotion] = useState(true)
  const [appState, setAppState] = useState(AppState.currentState || 'active')

  useEffect(() => {
    let mounted = true
    let preferenceChanged = false
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (mounted && !preferenceChanged) setReduceMotion(enabled) })
      .catch(() => {})
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      preferenceChanged = true
      setReduceMotion(enabled)
    })
    const appSubscription = AppState.addEventListener('change', setAppState)
    return () => {
      mounted = false
      motionSubscription?.remove()
      appSubscription?.remove()
    }
  }, [])

  useEffect(() => {
    rotation.setValue(0)
    if (reduceMotion || appState !== 'active') return undefined
    const animation = Animated.loop(Animated.timing(rotation, {
      toValue: 1,
      duration: 1600,
      easing: Easing.linear,
      isInteraction: false,
      useNativeDriver: true,
    }))
    animation.start()
    return () => animation.stop()
  }, [appState, reduceMotion, rotation])

  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={[styles.frame, style, { width: diameter, height: diameter }]}
      testID="brand-loader"
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.disc, {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          transform: [{ perspective: 600 }, { rotateY: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
        }]}
        testID="brand-loader-disc"
      >
        <Image
          accessible={false}
          source={logoSource}
          resizeMode="contain"
          style={{ position: 'absolute', width: emblem.sourceSize * scale, height: emblem.sourceSize * scale, left: -emblem.left * scale, top: -emblem.top * scale }}
        />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  disc: { backgroundColor: '#000000', overflow: 'hidden' },
})
