import { Pressable, Text, View } from 'react-native'
import { DEVICE_THEME_MODES } from './deviceThemeCore'

export function DeviceThemeChoices({ value, onChange, palette }) {
  return <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
    {DEVICE_THEME_MODES.map(mode => <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={mode[0].toUpperCase() + mode.slice(1)} aria-checked={value === mode} accessibilityState={{ checked: value === mode }} onPress={() => onChange(mode)} style={{ minHeight: 48, minWidth: 64, justifyContent: 'center', alignItems: 'center', borderBottomWidth: value === mode ? 3 : 1, borderBottomColor: value === mode ? palette.accentText : palette.border, paddingHorizontal: 8 }}>
      <Text style={{ color: value === mode ? palette.accentText : palette.textMuted, fontWeight: value === mode ? '800' : '600' }}>{mode[0].toUpperCase() + mode.slice(1)}</Text>
    </Pressable>)}
  </View>
}
