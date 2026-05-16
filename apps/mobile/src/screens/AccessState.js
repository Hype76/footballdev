import { SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { useAuth } from '../lib/auth'
import { colors, spacing } from '../theme'

export function AccessState({ message, title }) {
  const { signOut } = useAuth()

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.kicker}>Workspace</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <Button onPress={signOut} variant="secondary">
            Sign Out
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
    gap: 18,
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
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
})
