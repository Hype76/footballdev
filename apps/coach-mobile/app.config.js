const { createMobileExpoConfig } = require('../mobile-core/appConfig.cjs')

module.exports = createMobileExpoConfig({
  appRole: 'coach',
  bundleIdentifier: 'com.footballplayer.coach',
  description: 'Coach and club staff app for Football Player.',
  easProjectId: '347965b1-f32f-47b1-8c86-7aa910fe2cb5',
  name: 'Football Player Coach',
  packageName: 'com.footballplayer.coach',
  scheme: 'footballplayercoach',
  slug: 'football-player-coach',
  version: '1.0.2',
})
