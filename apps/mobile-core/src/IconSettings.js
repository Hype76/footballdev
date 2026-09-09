import { Children, useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

export function SettingsSection({ children }) {
  return <View style={styles.section}>{children}</View>
}

export function IconMenu({ items, palette, Icon: iconComponent, onSelect, accessibilityLabel }) {
  const Icon = iconComponent
  const { width, fontScale } = useWindowDimensions()
  const columns = width < 360 || fontScale > 1.3 ? 2 : 3
  const text = palette.textPrimary || palette.text
  const accent = palette.accentText || palette.accent
  return <View style={styles.menu} accessibilityLabel={accessibilityLabel}>
    {items.map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label}
      accessibilityHint={item.hint || `Opens ${item.label}`} onPress={() => onSelect(item.key)}
      style={({ pressed }) => [styles.item, { width: `${100 / columns}%` }, pressed && styles.pressed]}>
      <Icon iconKey={item.iconKey} color={accent} size={32} />
      <Text style={[styles.label, { color: text }]}>{item.label}</Text>
    </Pressable>)}
  </View>
}

export function IconSettings({ children, footer, palette, Icon: iconComponent, focusRequest, onNavigate }) {
  const Icon = iconComponent
  const sections = Children.toArray(children).filter(Boolean)
  const [activeKey, setActiveKey] = useState(null)
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
      <IconMenu accessibilityLabel="Settings categories" Icon={Icon} palette={palette} onSelect={open}
        items={sections.map(section => ({ key: section.props.id, label: section.props.label, iconKey: section.props.iconKey, hint: `Opens ${section.props.label} settings` }))} />
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
