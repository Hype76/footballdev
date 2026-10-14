import { Pressable, StyleSheet, View } from 'react-native'

// The iOS switch proportions are shared by both apps and platforms.
export function MobileSwitch({ accessibilityState, activeThumbColor, disabled = false, ios_backgroundColor, onChange, onKeyDown, onValueChange, style, thumbColor, trackColor, value, ...props }) {
  const checked = value === true
  const change = (event) => {
    if (disabled) return
    const nextValue = !checked
    onChange?.({ ...event, nativeEvent: { ...event.nativeEvent, value: nextValue } })
    onValueChange?.(nextValue)
  }
  return (
    <Pressable
      {...props}
      accessibilityRole="switch"
      accessibilityState={{ ...accessibilityState, checked, disabled }}
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!disabled && !event.defaultPrevented && !event.repeat && [' ', 'Spacebar'].includes(event.key)) {
          event.preventDefault()
          change(event)
        }
      }}
      onPress={change}
      style={[styles.touchTarget, style, disabled && styles.disabled]}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: checked ? '#15803d' : trackColor?.false || ios_backgroundColor || '#e9e9eb' }]}>
        <View style={[styles.thumb, { backgroundColor: checked ? '#ffffff' : thumbColor || activeThumbColor || '#ffffff', transform: [{ translateX: checked ? 20 : 0 }] }]} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  touchTarget: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 51 },
  track: { borderRadius: 16, height: 31, padding: 2, width: 51 },
  thumb: { borderRadius: 14, height: 27, width: 27 },
  disabled: { opacity: 0.5 },
})
