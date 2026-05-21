const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || ''
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''
const supabaseEnvironment = process.env.EXPO_PUBLIC_SUPABASE_ENV || 'test'
const allowLiveSupabase = process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || 'false'
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || ''
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || ''

module.exports = {
  expo: {
    name: 'Football Player Coach',
    slug: 'football-player-coach',
    description: 'Coach and club staff app for Football Player.',
    version: '0.1.0',
    runtimeVersion: {
      policy: 'appVersion',
    },
    orientation: 'portrait',
    icon: './assets/icon.png',
    backgroundColor: '#030603',
    primaryColor: '#d7ff2f',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    scheme: 'footballplayercoach',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#030603',
    },
    ios: {
      bundleIdentifier: 'com.footballplayer.coach',
      buildNumber: '1',
      supportsTablet: false,
      infoPlist: {
        NSFaceIDUsageDescription: 'Football Player Coach uses Face ID to unlock your saved session when biometric login is enabled.',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.footballplayer.coach',
      versionCode: 1,
      blockedPermissions: [
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.BLUETOOTH',
        'android.permission.CAMERA',
        'android.permission.READ_CONTACTS',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.RECORD_AUDIO',
      ],
      permissions: [
        'POST_NOTIFICATIONS',
        'USE_BIOMETRIC',
        'USE_FINGERPRINT',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#030603',
      },
      edgeToEdgeEnabled: true,
    },
    plugins: [
      [
        'expo-notifications',
        {
          color: '#d7ff2f',
          defaultChannel: 'matchday',
          icon: './assets/notification-icon.png',
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'Football Player Coach uses Face ID to unlock your saved session when biometric login is enabled.',
        },
      ],
      'expo-secure-store',
    ],
    extra: {
      allowLiveSupabase,
      apiBaseUrl,
      appRole: 'coach',
      eas: {
        projectId: easProjectId,
      },
      easProjectId,
      supabaseEnvironment,
      supabasePublishableKey,
      supabaseUrl,
    },
  },
}
