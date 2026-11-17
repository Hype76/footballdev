import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet } from 'react-native'
import { getParentProductDateTimeParts } from '../../mobile-core/src/parentDateTimeCore.js'

const currentMatchdayDate = () => getParentProductDateTimeParts(new Date()).date

export function useParentScorerGuideDate(enabled) {
  const [date, setDate] = useState(currentMatchdayDate)
  useEffect(() => {
    if (!enabled) return undefined
    const update = () => setDate(currentMatchdayDate())
    update()
    const timer = setInterval(update, 60000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') update() })
    return () => { clearInterval(timer); subscription?.remove() }
  }, [enabled])
  return enabled ? date : ''
}

export function ScorerGuidePulse({ color, rounded = false }) {
  const [opacity] = useState(() => new Animated.Value(1))
  const [reduceMotion, setReduceMotion] = useState(true)
  const [appState, setAppState] = useState(AppState.currentState || 'active')
  useEffect(() => {
    let mounted = true
    let changed = false
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => { if (mounted && !changed) setReduceMotion(enabled) })
      .catch(() => {})
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      changed = true
      setReduceMotion(enabled)
    })
    const visibility = AppState.addEventListener('change', setAppState)
    return () => {
      mounted = false
      motion?.remove()
      visibility?.remove()
    }
  }, [])
  useEffect(() => {
    opacity.setValue(1)
    if (reduceMotion || appState !== 'active') return undefined
    const options = { duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { ...options, toValue: 0.3 }),
      Animated.timing(opacity, { ...options, toValue: 1 }),
    ]))
    pulse.start()
    return () => pulse.stop()
  }, [appState, opacity, reduceMotion])
  return <Animated.View accessible={false} importantForAccessibility="no" pointerEvents="none" testID="parent-scorer-guide"
    style={[rounded ? styles.inset : styles.underline, { borderColor: color, opacity }]} />
}

const styles = StyleSheet.create({
  inset: { position: 'absolute', top: 2, right: 2, bottom: 2, left: 2, borderRadius: 10, borderWidth: 2 },
  underline: { position: 'absolute', bottom: 0, left: 6, right: 6, borderBottomWidth: 3, borderRadius: 2 },
})
