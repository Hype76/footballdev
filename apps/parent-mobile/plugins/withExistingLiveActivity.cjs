const { default: withWidgetExtension } = require('react-native-widget-extension/app.plugin.js')

module.exports = function withExistingLiveActivity(config, options) {
  // The widget plugin derives its target and bundle ID from the Expo name.
  // Keep the provisioned extension when the host app display name changes.
  const widgetConfig = withWidgetExtension({ ...config, name: 'Football Player Parents' }, options)
  return { ...widgetConfig, name: config.name }
}
