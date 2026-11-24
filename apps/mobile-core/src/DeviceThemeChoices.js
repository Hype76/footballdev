import { Pressable, Text, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { DEVICE_THEME_MODES } from './deviceThemeCore'

export function DeviceThemeChoices({ value, onChange, palette, polished = false }) {
  if (polished) return <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
    {DEVICE_THEME_MODES.map(mode => {
      const selected = value === mode
      const colour = selected ? palette.accentForeground : palette.textMuted
      const label = mode[0].toUpperCase() + mode.slice(1)
      return <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={label} aria-checked={selected} accessibilityState={{ checked: selected }} onPress={() => onChange(mode)} style={{ flex: 1, minHeight: 44, minWidth: 74, flexDirection: 'row', gap: 4, justifyContent: 'center', alignItems: 'center', borderRadius: 20, borderWidth: 1, borderColor: selected ? palette.buttonPrimary : palette.border, backgroundColor: selected ? palette.buttonPrimary : palette.surfaceRaised, paddingHorizontal: 4 }}>
        <MaterialIcons accessible={false} name={{ system: 'computer', light: 'light-mode', dark: 'dark-mode' }[mode]} color={colour} size={17} />
        <Text style={{ color: colour, fontSize: 12, fontWeight: selected ? '800' : '600' }}>{label}</Text>
      </Pressable>
    })}
  </View>
  return <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
    {DEVICE_THEME_MODES.map(mode => <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={mode[0].toUpperCase() + mode.slice(1)} aria-checked={value === mode} accessibilityState={{ checked: value === mode }} onPress={() => onChange(mode)} style={{ minHeight: 48, minWidth: 64, justifyContent: 'center', alignItems: 'center', borderBottomWidth: value === mode ? 3 : 1, borderBottomColor: value === mode ? palette.accentText : palette.border, paddingHorizontal: 8 }}>
      <Text style={{ color: value === mode ? palette.accentText : palette.textMuted, fontWeight: value === mode ? '800' : '600' }}>{mode[0].toUpperCase() + mode.slice(1)}</Text>
    </Pressable>)}
  </View>
}
