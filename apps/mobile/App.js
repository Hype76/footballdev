import 'react-native-url-polyfill/auto'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { AuthProvider, useAuth } from './src/lib/auth'
import { AccessState } from './src/screens/AccessState'
import { HomeScreen } from './src/screens/HomeScreen'
import { LoginScreen } from './src/screens/LoginScreen'
import { LockedScreen } from './src/screens/LockedScreen'
import { colors } from './src/theme'

function AppContent() {
  const { authError, isLoading, isLocked, session, unlockWithBiometrics, user } = useAuth()

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Loading Player Feedback</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!session?.user) {
    return <LoginScreen />
  }

  if (isLocked) {
    return <LockedScreen onUnlock={unlockWithBiometrics} />
  }

  if (!user) {
    return (
      <AccessState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (user.accountStatus === 'suspended') {
    return <AccessState title="Account access suspended" message="This account cannot currently access the mobile app." />
  }

  if (user.clubStatus === 'suspended') {
    return <AccessState title="Club access suspended" message="This club workspace cannot currently be opened in the mobile app." />
  }

  if (user.testerAccessExpired || !user.hasActivePlanAccess) {
    return <AccessState title="Access unavailable" message="This account does not currently have access." />
  }

  return <HomeScreen />
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AppContent />
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 14,
  },
})
