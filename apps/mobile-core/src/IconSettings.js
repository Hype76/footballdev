import { Children, useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

export function SettingsSection({ children }) {
  return <View style={styles.section}>{children}</View>
}

export function IconSettings({ children, footer, palette, Icon: iconComponent, focusRequest, onNavigate }) {
  const Icon = iconComponent
  const sections = Children.toArray(children).filter(Boolean)
  const [activeKey, setActiveKey] = useState(null)
  const { width, fontScale } = useWindowDimensions()
  const columns = width < 360 || fontScale > 1.3 ? 2 : 3
  const onNavigateRef = useRef(onNavigate)
  useEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useEffect(() => {
    if (!focusRequest) return
    const frame = requestAnimationFrame(() => {
      setActiveKey('notifications')
      onNavigateRef.current?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest])
  useEffect(() => {
    if (!activeKey) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActiveKey(null)
      onNavigateRef.current?.()
      return true
    })
    return () => subscription.remove()
  }, [activeKey])
  const open = (key) => { setActiveKey(key); onNavigateRef.current?.() }
  const text = palette.textPrimary || palette.text
  const accent = palette.accentText || palette.accent
  const active = sections.find(section => section.props.id === activeKey)
  return <View style={styles.section}>
    {active ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Settings" onPress={() => open(null)}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Icon iconKey="action.back" color={accent} size={24} />
        <Text style={[styles.backLabel, { color: accent }]}>Settings</Text>
      </Pressable>
      {active}
    </> : <>
      <View style={styles.menu} accessibilityLabel="Settings categories">
        {sections.map(section => <Pressable key={section.props.id} accessibilityRole="button" accessibilityLabel={section.props.label}
          accessibilityHint={`Opens ${section.props.label} settings`} onPress={() => open(section.props.id)}
          style={({ pressed }) => [styles.item, { width: `${100 / columns}%` }, pressed && styles.pressed]}>
          <Icon iconKey={section.props.iconKey} color={accent} size={32} />
          <Text style={[styles.label, { color: text }]}>{section.props.label}</Text>
        </Pressable>)}
      </View>
      {footer}
    </>}
  </View>
}

const styles = StyleSheet.create({
  section: { gap: 16 }, menu: { flexDirection: 'row', flexWrap: 'wrap' },
  item: { minHeight: 96, paddingHorizontal: 6, paddingVertical: 16, gap: 10, alignItems: 'center', justifyContent: 'center' },
  label: { maxWidth: '100%', fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  back: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'flex-start' },
  backLabel: { fontSize: 16, fontWeight: '600' }, pressed: { opacity: 0.65 },
})
