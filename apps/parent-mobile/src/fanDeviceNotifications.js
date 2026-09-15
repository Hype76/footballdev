export async function readFanDeviceNotifications({ notifications, secureStore, request }) {
  const permission = await notifications.getPermissionsAsync()
  if (permission.status !== 'granted') return { status: 'off', canAskAgain: permission.canAskAgain !== false }
  const token = await secureStore.getItemAsync('fan-notification-device')
  if (!token) return { status: 'not_registered', canAskAgain: true }
  const result = await request({ action: 'device_status', token })
  return { status: result.registered === true ? 'enabled' : 'not_registered', canAskAgain: true }
}

export async function enableFanDeviceNotifications({ notifications, secureStore, request, projectId }) {
  const permission = await notifications.requestPermissionsAsync()
  if (permission.status !== 'granted') throw new Error('Notifications are not enabled in your phone settings.')
  const token = (await notifications.getExpoPushTokenAsync({ projectId })).data
  await request({ action: 'register_device', token })
  await secureStore.setItemAsync('fan-notification-device', token)
  const current = await readFanDeviceNotifications({ notifications, secureStore, request })
  if (current.status !== 'enabled') throw new Error('Phone notification registration could not be confirmed. Please try again.')
  return current
}
