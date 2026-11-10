const SATELLITE_METADATA = 'android.telephony.PROPERTY_SATELLITE_DATA_OPTIMIZED'

// Resolve Expo from the consuming app, because mobile-core shares its dependencies.
module.exports = function withSatellite(config) {
  const { AndroidConfig, withAndroidManifest } = require(require.resolve('expo/config-plugins', {
    paths: [config._internal?.projectRoot || process.cwd()],
  }))

  return withAndroidManifest(config, (modConfig) => {
    const packageName = modConfig.android?.package

    if (!packageName) {
      throw new Error('Satellite support requires an Android application package name.')
    }

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults)
    // Replace any old value and duplicates while preserving unrelated manifest entries.
    application['meta-data'] = (application['meta-data'] || [])
      .filter((entry) => entry.$?.['android:name'] !== SATELLITE_METADATA)
    application['meta-data'].push({
      $: {
        'android:name': SATELLITE_METADATA,
        'android:value': packageName,
      },
    })

    return modConfig
  })
}
