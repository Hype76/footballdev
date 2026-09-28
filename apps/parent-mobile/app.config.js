const { createMobileExpoConfig } = require('../mobile-core/appConfig.cjs')

const config = createMobileExpoConfig({
  appRole: 'parent',
  bundleIdentifier: 'com.footballplayer.parents',
  description: 'Parent portal app for Football Player updates and notifications.',
  easProjectId: '7e0906f3-64f4-42d9-b45d-0ee68f599baa',
  name: 'Football Player Parents',
  packageName: 'com.footballplayer.parents',
  scheme: 'footballplayerparents',
  slug: 'football-player-parents',
  version: '1.0.22',
  plugins: [['expo-calendar', { calendarPermission: 'Football Player uses your calendar to synchronise events you accept.' }]],
})

config.expo.android.permissions.push('READ_CALENDAR', 'WRITE_CALENDAR')

module.exports = config
