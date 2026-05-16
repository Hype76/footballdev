const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || ''
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''
const supabaseEnvironment = process.env.EXPO_PUBLIC_SUPABASE_ENV || 'test'
const allowLiveSupabase = process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || 'false'

module.exports = {
  expo: {
    name: 'Player Feedback',
    slug: 'player-feedback',
    description: 'Login-only mobile workspace for Player Feedback club staff.',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    backgroundColor: '#030603',
    primaryColor: '#d7ff2f',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    scheme: 'playerfeedback',
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      fallbackToCacheTimeout: 0,
    },
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#030603',
    },
    ios: {
      bundleIdentifier: 'com.playerfeedback.app',
      supportsTablet: true,
      buildNumber: '1',
      infoPlist: {
        NSFaceIDUsageDescription: 'Player Feedback uses Face ID to unlock your saved session when biometric login is enabled.',
        ITSAppUsesNonExemptEncryption: false,
      },
      config: {
        usesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.playerfeedback.app',
      versionCode: 1,
      blockedPermissions: [
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.CAMERA',
        'android.permission.READ_CONTACTS',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.RECORD_AUDIO',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#030603',
      },
      edgeToEdgeEnabled: true,
    },
    plugins: [
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'Player Feedback uses Face ID to unlock your saved session when biometric login is enabled.',
        },
      ],
      'expo-secure-store',
    ],
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      supabaseUrl,
      supabasePublishableKey,
      supabaseEnvironment,
      allowLiveSupabase,
    },
  },
}
