const { createMobileExpoConfig } = require('../mobile-core/appConfig.cjs')

module.exports = createMobileExpoConfig({
  appRole: 'coach',
  bundleIdentifier: 'com.footballplayer.coach',
  description: 'Coach and club staff app for Football Player.',
  name: 'Football Player Coach',
  packageName: 'com.footballplayer.coach',
  scheme: 'footballplayercoach',
  slug: 'football-player-coach',
  version: '0.1.0',
})
