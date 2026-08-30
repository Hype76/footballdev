import AsyncStorage from '@react-native-async-storage/async-storage'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import {
  clampCoachQuickActionPosition,
  getCoachQuickActionStorageKey,
  parseCoachQuickActionPosition,
  serializeCoachQuickActionPosition,
} from './coachQuickActionsCore'
import { getCoachQuickActionIconKey, getMobileIconName } from '../../mobile-core/src/mobileIconSystem'

function createStyles(palette, bottomInset) {
  return StyleSheet.create({
    action: {
      alignItems: 'center',
      borderBottomColor: palette.border,
      borderBottomWidth: 1,
      flexDirection: 'row',
      gap: 12,
      minHeight: 58,
      paddingHorizontal: 4,
      paddingVertical: 8,
    },
    actionCopy: { flex: 1 },
    actionText: { color: palette.textPrimary, fontSize: 15, fontWeight: '900' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.58)' },
    close: { alignItems: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    closeText: { color: palette.accent, fontSize: 14, fontWeight: '900' },
    fab: {
      alignItems: 'center',
      backgroundColor: palette.accent,
      borderColor: palette.accent,
      borderRadius: 30,
      borderWidth: 1,
      elevation: 8,
      height: 60,
      justifyContent: 'center',
      shadowColor: '#000000',
      shadowOffset: { height: 5, width: 0 },
      shadowOpacity: 0.28,
      shadowRadius: 9,
      width: 60,
    },
    fabDragging: { opacity: 0.82, transform: [{ scale: 1.05 }] },
    floating: { left: 0, position: 'absolute', top: 0, zIndex: 80 },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    kicker: { color: palette.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
    menu: {
      backgroundColor: palette.surface,
      borderColor: palette.border,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderWidth: 1,
      bottom: 0,
      gap: 12,
      left: 0,
      maxHeight: '82%',
      paddingBottom: Math.max(16, bottomInset + 10),
      paddingHorizontal: 16,
      paddingTop: 14,
      position: 'absolute',
      right: 0,
    },
    menuCopy: { color: palette.textSecondary, fontSize: 13, lineHeight: 19 },
    menuTitle: { color: palette.textPrimary, fontSize: 24, fontWeight: '900' },
    overlay: { flex: 1, justifyContent: 'flex-end' },
    scrollContent: { paddingBottom: 4 },
  })
}

export function CoachQuickActions({ actions, bottomInset = 0, onAction, palette, userId }) {
  const viewport = useWindowDimensions()
  const styles = useMemo(() => createStyles(palette, bottomInset), [bottomInset, palette])
  const storageKey = useMemo(() => getCoachQuickActionStorageKey(userId), [userId])
  const viewportSize = useMemo(() => ({ height: viewport.height, width: viewport.width }), [viewport.height, viewport.width])
  const initialPosition = useMemo(() => clampCoachQuickActionPosition({ x: viewportSize.width - 72, y: 84 }, viewportSize, bottomInset), [bottomInset, viewportSize])
  const [animatedPosition] = useState(() => new Animated.ValueXY(initialPosition))
  const [position, setPosition] = useState(initialPosition)
  const renderedPosition = useMemo(() => clampCoachQuickActionPosition(position, viewportSize, bottomInset), [bottomInset, position, viewportSize])
  const [dragging, setDragging] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [open, setOpen] = useState(false)

  const commitPosition = useCallback((nextPosition) => {
    const next = clampCoachQuickActionPosition(nextPosition, viewportSize, bottomInset)
    setPosition(next)
    animatedPosition.setValue(next)
    void AsyncStorage.setItem(storageKey, serializeCoachQuickActionPosition(next)).catch(() => {})
  }, [animatedPosition, bottomInset, storageKey, viewportSize])

  useEffect(() => {
    let mounted = true
    void AsyncStorage.getItem(storageKey).then((value) => {
      if (!mounted) return
      const saved = parseCoachQuickActionPosition(value)
      const next = clampCoachQuickActionPosition(saved || initialPosition, viewportSize, bottomInset)
      setPosition(next)
      animatedPosition.setValue(next)
    }).catch(() => {})
    return () => { mounted = false }
  }, [animatedPosition, bottomInset, initialPosition, storageKey, viewportSize])

  useEffect(() => {
    animatedPosition.setValue(renderedPosition)
  }, [animatedPosition, renderedPosition])

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => {
      setDragging(true)
    },
    onPanResponderMove: (_, gesture) => {
      const next = clampCoachQuickActionPosition({
        x: renderedPosition.x + gesture.dx,
        y: renderedPosition.y + gesture.dy,
      }, viewportSize, bottomInset)
      animatedPosition.setValue(next)
    },
    onPanResponderRelease: (_, gesture) => {
      setDragging(false)
      commitPosition({
        x: renderedPosition.x + gesture.dx,
        y: renderedPosition.y + gesture.dy,
      })
    },
    onPanResponderTerminate: () => {
      setDragging(false)
      animatedPosition.setValue(renderedPosition)
    },
  }), [animatedPosition, bottomInset, commitPosition, renderedPosition, viewportSize])

  if (!actions.length || keyboardVisible) return null

  return (
    <>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.floating, { transform: animatedPosition.getTranslateTransform() }]}
      >
        <Pressable
          accessibilityHint="Tap to open Quick Add. Drag to move this button."
          accessibilityLabel="Open Quick Add"
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.fab, dragging && styles.fabDragging, pressed && { opacity: 0.78 }]}
        >
          <MaterialIcons color={palette.accentForeground} name="add" size={31} />
        </Pressable>
      </Animated.View>

      <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <View style={styles.overlay}>
          <Pressable accessibilityLabel="Close Quick Add" onPress={() => setOpen(false)} style={styles.backdrop} />
          <View accessibilityViewIsModal style={styles.menu}>
            <View style={styles.header}>
              <View>
                <Text style={styles.kicker}>Quick add</Text>
                <Text accessibilityRole="header" style={styles.menuTitle}>What do you need?</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.close}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.menuCopy}>Jump straight into the job without finding it in the navigation.</Text>
            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
              {actions.map((action) => (
                <Pressable
                  accessibilityLabel={action.label}
                  accessibilityRole="button"
                  key={action.id}
                  onPress={() => { setOpen(false); onAction(action) }}
                  style={({ pressed }) => [styles.action, pressed && { opacity: 0.76 }]}
                >
                  <MaterialIcons color={palette.accent} name={getMobileIconName(getCoachQuickActionIconKey(action.id))} size={28} />
                  <View style={styles.actionCopy}><Text style={styles.actionText}>{action.label}</Text></View>
                  <MaterialIcons color={palette.accent} name="add" size={20} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}
