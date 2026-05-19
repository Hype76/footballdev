import { useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Button } from '../components/Button'
import { TextField } from '../components/TextField'
import { useAuth } from '../lib/auth'
import { colors, spacing } from '../theme'

const logo = require('../../assets/football-player-logo.png')

function getFriendlyAuthError(error) {
  const message = String(error?.message || '').trim()
  if (!message) {
    return 'Login failed.'
  }

  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'Check your email and password, then try again.'
  }

  return message
}

export function LoginScreen() {
  const { authError, signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  const handleSubmit = async () => {
    setLocalError('')
    setIsSubmitting(true)

    try {
      await signInWithPassword({ email, password })
    } catch (error) {
      setLocalError(getFriendlyAuthError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <View style={styles.webWrap}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Image source={logo} style={styles.logo} />
              <View style={styles.headerText}>
                <Text style={styles.brand}>Football Player</Text>
                <Text style={styles.subhead}>Club operations and player feedback software</Text>
              </View>
            </View>

            <View style={styles.shell}>
              <View style={styles.hero}>
                <Text style={styles.kicker}>Mobile app</Text>
                <Text style={styles.title}>Log in to your club workspace.</Text>
                <Text style={styles.copy}>Use the same account you use on the website.</Text>
              </View>

              <View style={styles.panel}>
                <TextField
                  keyboardType="email-address"
                  label="Email"
                  onChangeText={setEmail}
                  placeholder="you@club.com"
                  value={email}
                />
                <TextField
                  label="Password"
                  onChangeText={setPassword}
                  placeholder="Password"
                  secureTextEntry
                  value={password}
                />

                {localError || authError ? <Text style={styles.error}>{localError || authError}</Text> : null}

                <Button disabled={isSubmitting || !email.trim() || !password} onPress={handleSubmit}>
                  {isSubmitting ? 'Logging in...' : 'Log In'}
                </Button>
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  brand: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  copy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  headerText: {
    flex: 1,
  },
  hero: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  keyboard: {
    flex: 1,
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  logo: {
    borderRadius: 8,
    height: 68,
    width: 68,
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    marginTop: 12,
    padding: spacing.card,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: Platform.OS === 'web' ? 10 : spacing.screen,
    paddingTop: 14,
  },
  subhead: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 4,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 37,
    marginTop: 12,
  },
  shell: {
    backgroundColor: colors.shell,
    borderColor: colors.border,
    borderRadius: Platform.OS === 'web' ? 8 : 0,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    marginTop: 12,
    padding: 12,
  },
  webWrap: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: Platform.OS === 'web' ? 460 : undefined,
    width: '100%',
  },
})
