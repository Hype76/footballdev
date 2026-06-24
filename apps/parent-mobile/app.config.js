const { createMobileExpoConfig } = require('../mobile-core/appConfig.cjs')

module.exports = createMobileExpoConfig({
  appRole: 'parent',
  bundleIdentifier: 'com.footballplayer.parents',
  description: 'Parent portal app for Football Player updates and notifications.',
  name: 'Football Player Parents',
  packageName: 'com.footballplayer.parents',
  scheme: 'footballplayerparents',
  slug: 'football-player-parents',
  version: '1.0.1',
})
