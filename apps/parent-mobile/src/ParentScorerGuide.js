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
      Animated.timing(opacity, { ...options, toValue: 0.6 }),
      Animated.timing(opacity, { ...options, toValue: 1 }),
    ]))
    pulse.start()
    return () => pulse.stop()
  }, [appState, opacity, reduceMotion])
  return <Animated.View accessible={false} importantForAccessibility="no" pointerEvents="none" testID="parent-scorer-guide"
    style={[rounded ? styles.inset : styles.underline, { borderColor: '#ffb900', backgroundColor: rounded ? 'transparent' : '#ffb900', shadowColor: color, opacity }]} />
}

const styles = StyleSheet.create({
  inset: { position: 'absolute', top: 1, right: 1, bottom: 1, left: 1, borderRadius: 10, borderWidth: 4, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.85, shadowRadius: 3 },
  underline: { position: 'absolute', bottom: 1, left: 5, right: 5, height: 5, borderWidth: 1, borderRadius: 3, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.85, shadowRadius: 3 },
})
