const { createMobileExpoConfig } = require('../mobile-core/appConfig.cjs')

module.exports = createMobileExpoConfig({
  appRole: 'parent',
  bundleIdentifier: 'com.footballplayer.parents',
  description: 'Parent portal app for Football Player updates and notifications.',
  easProjectId: '7e0906f3-64f4-42d9-b45d-0ee68f599baa',
  name: 'Football Player Parents',
  packageName: 'com.footballplayer.parents',
  scheme: 'footballplayerparents',
  slug: 'football-player-parents',
  version: '1.0.13',
})
