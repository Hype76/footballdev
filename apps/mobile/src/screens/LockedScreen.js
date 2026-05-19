import { SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { useAuth } from '../lib/auth'
import { colors, spacing } from '../theme'

export function LockedScreen({ onUnlock }) {
  const { signOut } = useAuth()

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.kicker}>Secure unlock</Text>
          <Text style={styles.title}>Football Player is locked.</Text>
          <Text style={styles.message}>Use your device security to unlock this session.</Text>
          <Button onPress={onUnlock}>Unlock</Button>
          <Button onPress={signOut} variant="secondary">
            Use Password Instead
          </Button>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    padding: spacing.card,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.screen,
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  message: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 34,
  },
})
