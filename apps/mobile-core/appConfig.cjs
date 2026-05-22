const fs = require('fs')
const path = require('path')

function getMobileEnvironment() {
  return {
    allowLiveSupabase: process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || 'false',
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || '',
    easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '',
    supabaseEnvironment: process.env.EXPO_PUBLIC_SUPABASE_ENV || 'test',
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  }
}

function getAndroidGoogleServicesFile() {
  const configuredPath = process.env.EXPO_ANDROID_GOOGLE_SERVICES_FILE

  if (configuredPath) {
    return configuredPath
  }

  if (process.env.MOBILE_EAS_REMOTE_BUILD === 'true') {
    return ''
  }

  const localPath = './google-services.json'
  const resolvedPath = path.resolve(process.cwd(), localPath)

  return fs.existsSync(resolvedPath) ? localPath : ''
}

function createMobileExpoConfig({
  appRole,
  bundleIdentifier,
  description,
  name,
  packageName,
  scheme,
  slug,
  version,
}) {
  const environment = getMobileEnvironment()
  const faceIdPermission = `${name} uses Face ID to unlock your saved session when biometric login is enabled.`
  const googleServicesFile = getAndroidGoogleServicesFile()

  return {
    expo: {
      name,
      slug,
      description,
      version,
      runtimeVersion: {
        policy: 'appVersion',
      },
      orientation: 'portrait',
      icon: './assets/icon.png',
      backgroundColor: '#030603',
      primaryColor: '#d7ff2f',
      userInterfaceStyle: 'dark',
      newArchEnabled: true,
      scheme,
      splash: {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#030603',
      },
      ios: {
        bundleIdentifier,
        buildNumber: '1',
        supportsTablet: false,
        infoPlist: {
          NSFaceIDUsageDescription: faceIdPermission,
          ITSAppUsesNonExemptEncryption: false,
        },
      },
      android: {
        package: packageName,
        versionCode: 1,
        ...(googleServicesFile ? { googleServicesFile } : {}),
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
            faceIDPermission: faceIdPermission,
          },
        ],
        'expo-secure-store',
      ],
      extra: {
        ...environment,
        appRole,
        eas: {
          projectId: environment.easProjectId,
        },
      },
    },
  }
}

module.exports = {
  createMobileExpoConfig,
  getMobileEnvironment,
}
