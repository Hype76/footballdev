import { useCallback, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

function createStyles(palette) {
  return StyleSheet.create({
    board: { alignSelf: 'center', width: '100%' },
    content: { alignItems: 'center', flexGrow: 1, paddingBottom: 4, paddingHorizontal: 18 },
    safeArea: { backgroundColor: palette.background, flex: 1 },
    screen: { backgroundColor: palette.background, flex: 1 },
  })
}

export function CoachFormationWorkspace({ children, onBack, palette, visible = true }) {
  const [markerGestureActive, setMarkerGestureActive] = useState(false)
  const [backHandler, setBackHandler] = useState(null)
  const leaving = useRef(false)
  const [safeHeight, setSafeHeight] = useState(0)
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const styles = createStyles(palette)
  const usableHeight = safeHeight || window.height - insets.top - insets.bottom
  const boardMaxWidth = window.height >= 700 && window.height > window.width
    ? Math.max(240, Math.min(window.width - 36, (usableHeight - 368) * 0.69))
    : Math.min(window.width - 36, 360)
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
        <View onLayout={event => setSafeHeight(event.nativeEvent.layout.height)} style={styles.screen}>
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
            <View style={[styles.board, { maxWidth: boardMaxWidth }]}>{content}</View>
          </ScrollView>
        </View>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}
