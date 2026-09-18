import { useCallback, useRef, useState } from 'react'
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { CoachFormationWorkspaceContext } from './coachFormationWorkspaceContext'

function createStyles() {
  return StyleSheet.create({
    board: { flex: 1, width: '100%' },
    back: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center', left: 4, minHeight: 44, minWidth: 70, paddingHorizontal: 12, position: 'absolute', top: 0, zIndex: 40 },
    safeArea: { backgroundColor: 'rgb(10,108,47)', flex: 1 },
    screen: { backgroundColor: 'rgb(10,108,47)', flex: 1 },
  })
}

export function CoachFormationWorkspace({ children, onBack, visible = true }) {
  const [markerGestureActive, setMarkerGestureActive] = useState(false)
  const [backHandler, setBackHandler] = useState(null)
  const leaving = useRef(false)
  const styles = createStyles()
  const handleMarkerGestureStart = useCallback(() => setMarkerGestureActive(true), [])
  const handleMarkerGestureEnd = useCallback(() => setMarkerGestureActive(false), [])
  const handleBack = useCallback(async () => {
    if (leaving.current) return
    leaving.current = true
    setMarkerGestureActive(false)
    try {
      if (backHandler) await backHandler()
      else await onBack?.()
    } finally { leaving.current = false }
  }, [backHandler, onBack])
  const registerBackHandler = useCallback((handler) => {
    const nextHandler = typeof handler === 'function' ? handler : null
    setBackHandler(() => nextHandler)
    return () => {
      setBackHandler((current) => current === nextHandler ? null : current)
    }
  }, [])

  const content = typeof children === 'function'
    ? children({ onMarkerGestureEnd: handleMarkerGestureEnd, onMarkerGestureStart: handleMarkerGestureStart, registerBackHandler })
    : children

  return (
    <Modal
      animationType="slide"
      navigationBarTranslucent={false}
      onDismiss={handleMarkerGestureEnd}
      onRequestClose={handleBack}
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      visible={visible}
    >
      <StatusBar barStyle="light-content" backgroundColor="rgb(10,108,47)" />
      <SafeAreaProvider>
      <SafeAreaView accessibilityViewIsModal edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea} testID="coach-formation-workspace">
        <View style={styles.screen}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close Formation Board" onPress={() => void handleBack()} style={styles.back}>
            <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Back</Text>
          </Pressable>
          <View
            style={styles.board}
            dataSet={{ markerGestureActive: markerGestureActive ? 'true' : 'false' }}
            testID="coach-formation-workspace-canvas"
          >
            <CoachFormationWorkspaceContext.Provider value={true}>{content}</CoachFormationWorkspaceContext.Provider>
          </View>
        </View>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}
