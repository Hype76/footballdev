import { useState } from 'react'
import { Image, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { useAuth } from '../lib/auth'
import { mobileRoutes } from '../lib/mobileRoutes'
import { colors, spacing } from '../theme'
import { AddPlayerScreen } from './AddPlayerScreen'
import { ListScreen } from './ListScreen'
import { ManageScreen } from './ManageScreen'

const logo = require('../../assets/player-feedback-logo.png')

const primaryKeys = ['sessions', 'players', 'add-player', 'create-session', 'evaluations', 'teams']
const managementKeys = ['archived-players', 'user-access', 'form-builder', 'parent-email-templates', 'activity-log', 'club-settings', 'platform-feedback', 'information', 'settings']

export function HomeScreen() {
  const { biometrics, setBiometricLoginEnabled, signOut, user } = useAuth()
  const [activeRoute, setActiveRoute] = useState(null)
  const [settingsError, setSettingsError] = useState('')
  const [isUpdatingBiometrics, setIsUpdatingBiometrics] = useState(false)

  const handleBiometricToggle = async (enabled) => {
    setSettingsError('')
    setIsUpdatingBiometrics(true)

    try {
      await setBiometricLoginEnabled(enabled)
    } catch (error) {
      setSettingsError(error.message || 'Biometric setting could not be changed.')
    } finally {
      setIsUpdatingBiometrics(false)
    }
  }

  if (activeRoute) {
    if (activeRoute.key === 'add-player') {
      return (
        <AddPlayerScreen
          onBack={() => setActiveRoute(null)}
          onCreated={() => {}}
          user={user}
        />
      )
    }

    if (!['sessions', 'players', 'evaluations'].includes(activeRoute.key)) {
      return (
        <ManageScreen
          onBack={() => setActiveRoute(null)}
          routeKey={activeRoute.key}
          title={activeRoute.title}
          user={user}
        />
      )
    }

    return (
      <ListScreen
        onBack={() => setActiveRoute(null)}
        routeKey={activeRoute.key}
        title={activeRoute.title}
        user={user}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.webWrap}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.topbar}>
            <Pressable style={styles.menuButton}>
              <Text style={styles.menuText}>Menu</Text>
            </Pressable>
            <Text style={styles.topbarTitle}>Dashboard</Text>
            <Image source={logo} style={styles.logo} />
          </View>

          <View style={styles.shell}>
            <View style={styles.pageHeader}>
              <Text style={styles.kicker}>{user.clubName}</Text>
              <Text style={styles.title}>Welcome, {user.name}</Text>
              <Text style={styles.description}>Open your club tools from the mobile workspace.</Text>
            </View>

            <View style={styles.grid}>
              {mobileRoutes
                .filter((route) => primaryKeys.includes(route.key))
                .map((route) => (
                  <Pressable
                    key={route.key}
                    onPress={() => setActiveRoute(route)}
                    style={({ pressed }) => [styles.navItem, pressed ? styles.navItemPressed : null]}
                  >
                    <View style={styles.navText}>
                      <Text style={styles.navTitle}>{route.title}</Text>
                      <Text style={styles.navDescription}>{route.description}</Text>
                    </View>
                    <Text style={styles.navChevron}>Open</Text>
                  </Pressable>
                ))}
            </View>

            <View style={styles.managementPanel}>
              <Text style={styles.panelLabel}>Management</Text>
              {mobileRoutes
                .filter((route) => managementKeys.includes(route.key))
                .map((route) => (
                  <Pressable
                    key={route.key}
                    onPress={() => setActiveRoute(route)}
                    style={({ pressed }) => [styles.navItem, pressed ? styles.navItemPressed : null]}
                  >
                    <View style={styles.navText}>
                      <Text style={styles.navTitle}>{route.title}</Text>
                      <Text style={styles.navDescription}>{route.description}</Text>
                    </View>
                    <Text style={styles.navChevron}>Open</Text>
                  </Pressable>
                ))}
            </View>

            <View style={styles.settingsCard}>
              <View style={styles.settingsHeader}>
                <View style={styles.settingsText}>
                  <Text style={styles.settingsTitle}>Biometric login</Text>
                  <Text style={styles.settingsDescription}>
                    {biometrics.available ? 'Use supported device security after login.' : 'No enrolled biometric security is available.'}
                  </Text>
                </View>
                <Switch
                  disabled={!biometrics.available || isUpdatingBiometrics}
                  onValueChange={handleBiometricToggle}
                  thumbColor={biometrics.enabled ? colors.accent : '#f4f4f4'}
                  trackColor={{ false: '#3b463a', true: '#6f891d' }}
                  value={biometrics.enabled}
                />
              </View>
              {settingsError ? <Text style={styles.error}>{settingsError}</Text> : null}
            </View>

            <Button onPress={signOut} variant="secondary">
              Sign Out
            </Button>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 12,
  },
  grid: {
    gap: 10,
    marginTop: 16,
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  logo: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    width: 42,
  },
  managementPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 10,
  },
  menuButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  menuText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  navChevron: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: '900',
  },
  navDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  navItem: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 66,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  navItemPressed: {
    backgroundColor: colors.sidebarActive,
  },
  navText: {
    flex: 1,
    paddingRight: 12,
  },
  navTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pageHeader: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  panelLabel: {
    color: colors.secondary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 8,
    paddingHorizontal: 4,
    textTransform: 'uppercase',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    padding: Platform.OS === 'web' ? 10 : 0,
    paddingBottom: 36,
  },
  settingsCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    marginTop: 12,
    padding: spacing.card,
  },
  settingsDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  settingsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  settingsText: {
    flex: 1,
  },
  settingsTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  shell: {
    backgroundColor: colors.shell,
    borderColor: colors.border,
    borderRadius: Platform.OS === 'web' ? 8 : 0,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    padding: 12,
  },
  title: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '900',
    lineHeight: 30,
    marginTop: 9,
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  topbarTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  webWrap: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: Platform.OS === 'web' ? 460 : undefined,
    width: '100%',
  },
})
