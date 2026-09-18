import { useCallback, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

function createStyles(palette) {
  return StyleSheet.create({
    board: { alignSelf: 'center', width: '100%' },
    content: { alignItems: 'center', flexGrow: 1, paddingBottom: 12, paddingHorizontal: 6 },
    safeArea: { backgroundColor: palette.background, flex: 1 },
    screen: { backgroundColor: palette.background, flex: 1 },
  })
}

export function CoachFormationWorkspace({ children, onBack, palette, visible = true }) {
  const [markerGestureActive, setMarkerGestureActive] = useState(false)
  const [backHandler, setBackHandler] = useState(null)
  const leaving = useRef(false)
  const styles = createStyles(palette)
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
      <SafeAreaProvider>
      <SafeAreaView accessibilityViewIsModal edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea} testID="coach-formation-workspace">
        <View style={styles.screen}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close Formation Board" onPress={() => void handleBack()} style={{ minHeight: 48, paddingHorizontal: 18, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text style={{ color: palette.textPrimary, fontSize: 16, fontWeight: '700' }}>Back</Text>
          </Pressable>
          <ScrollView
            alwaysBounceVertical={false}
            automaticallyAdjustKeyboardInsets
            bounces={false}
            contentContainerStyle={styles.content}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            scrollEnabled={!markerGestureActive}
            showsVerticalScrollIndicator={false}
            dataSet={{ markerGestureActive: markerGestureActive ? 'true' : 'false' }}
            testID="coach-formation-workspace-scroll"
          >
            <View style={styles.board}>{content}</View>
          </ScrollView>
        </View>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}
