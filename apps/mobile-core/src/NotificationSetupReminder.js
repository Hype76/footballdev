import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { createNotificationReminderController, notificationReminderKey, shouldShowNotificationReminder } from './notificationReminderCore.js'

const deviceStorage = {
  read: key => SecureStore.getItemAsync(key),
  write: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
}
const visitDismissals = new Set()

export function NotificationSetupReminder({ appRole, userId, state, status, offline = false, busy = false, palette, onOpenSettings, storage = deviceStorage }) {
  const [snapshot, setSnapshot] = useState({ key: null, visible: false })
  const controller = useMemo(() => createNotificationReminderController({ storage, onChange: setSnapshot, completed: visitDismissals }), [storage])
  const scopeKey = notificationReminderKey(appRole, userId)
  const currentScope = useRef(scopeKey)
  useLayoutEffect(() => { currentScope.current = scopeKey }, [scopeKey])
  useEffect(() => { void controller.check({ appRole, userId, state, status, offline, busy }) }, [controller, appRole, userId, state, status, offline, busy])
  useEffect(() => () => controller.dispose(), [controller])
  const dismiss = () => currentScope.current === scopeKey && controller.dismiss(scopeKey)
  const visible = snapshot.visible && snapshot.key === scopeKey && shouldShowNotificationReminder({ state, status, offline, busy })
  useEffect(() => { if (visible) Keyboard.dismiss() }, [visible])
  const text = palette.textPrimary || palette.text
  return <Modal animationType="fade" transparent visible={visible} onRequestClose={dismiss}>
    <View style={styles.backdrop}>
      <ScrollView accessibilityViewIsModal showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} style={[styles.dialog, { backgroundColor: palette.surface || palette.card || palette.background, borderColor: palette.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: text }]}>Turn on notifications</Text>
        <Text style={[styles.copy, { color: palette.textSecondary || text }]}>Enable push alerts so you do not miss match, calendar and team updates. You can choose which alerts you receive in Settings.</Text>
        <Pressable accessibilityRole="button" onPress={() => { if (dismiss()) onOpenSettings?.() }} style={styles.action}>
          <Text style={[styles.actionText, { color: palette.accentText || palette.accent || text }]}>Open notification settings</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={dismiss} style={styles.action}><Text style={[styles.actionText, { color: text }]}>Not now</Text></Pressable>
      </ScrollView>
    </View>
  </Modal>
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: '#0008', flex: 1, justifyContent: 'center', padding: 20 },
  dialog: { borderRadius: 12, borderWidth: 1, flexGrow: 0, maxHeight: '90%', maxWidth: 380, width: '100%' },
  content: { gap: 8, padding: 20 },
  title: { fontSize: 22, fontWeight: '800' },
  copy: { fontSize: 15, lineHeight: 22 },
  action: { justifyContent: 'center', minHeight: 48, paddingVertical: 8 },
  actionText: { fontSize: 15, fontWeight: '700' },
})
