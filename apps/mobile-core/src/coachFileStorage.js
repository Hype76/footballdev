const LEGACY_ENVELOPE_LIMIT = 1_950_000

// Only encrypted generation envelopes use files. Pointers and the existing
// keychain key stay in their original stores, allowing existing data to open.
export function createCoachFileStorage({ fileSystem, legacyStorage, appRole = 'coach' }) {
  if (!['coach', 'parent'].includes(appRole)) throw new Error('offline_storage_role_invalid')
  const prefix = `^fp\\.mobile\\.offline\\.v1\\.${appRole}\\.(?:live|test)\\.[a-z0-9]+(?:\\.${appRole}2\\.[A-Za-z0-9_-]+)?`
  const POINTER_KEY = new RegExp(`${prefix}\\.active$`)
  const GENERATION_KEY = new RegExp(`${prefix}\\.g\\.[ab]$`)
  const supported = Boolean(fileSystem?.documentDirectory && ['getInfoAsync', 'makeDirectoryAsync', 'readAsStringAsync', 'writeAsStringAsync', 'moveAsync', 'deleteAsync'].every(name => typeof fileSystem[name] === 'function'))
  const directory = supported ? `${fileSystem.documentDirectory.replace(/\/*$/, '')}/fp-${appRole}-offline-v1/` : ''
  const file = key => `${directory}${key}.json`
  const marker = key => `${key}.file-backed`
  return {
    async getItem(key) {
      if (!GENERATION_KEY.test(key)) return legacyStorage.getItem(key)
      if (!supported) {
        if (await legacyStorage.getItem(marker(key))) throw new Error('offline_storage_file_unavailable')
        return legacyStorage.getItem(key)
      }
      const info = await fileSystem.getInfoAsync(file(key), {})
      if (!info.exists) {
        const backup = await fileSystem.getInfoAsync(`${file(key)}.previous`, {})
        if (backup.exists && !backup.isDirectory) return fileSystem.readAsStringAsync(`${file(key)}.previous`, { encoding: 'utf8' })
        if (await legacyStorage.getItem(marker(key))) throw new Error('offline_storage_file_unavailable')
        return legacyStorage.getItem(key)
      }
      if (info.isDirectory) throw new Error('offline_storage_invalid_file')
      return fileSystem.readAsStringAsync(file(key), { encoding: 'utf8' })
    },
    async setItem(key, value) {
      if (!GENERATION_KEY.test(key)) return legacyStorage.setItem(key, value)
      if (!supported) {
        if (value.length > LEGACY_ENVELOPE_LIMIT) throw new Error('offline_cache_payload_too_large')
        return legacyStorage.setItem(key, value)
      }
      await fileSystem.makeDirectoryAsync(directory, { intermediates: true })
      const target = file(key), pending = `${target}.pending`
      await fileSystem.deleteAsync(pending, { idempotent: true })
      await fileSystem.writeAsStringAsync(pending, value, { encoding: 'utf8' })
      await legacyStorage.setItem(marker(key), '1')
      const previous = `${target}.previous`
      const current = await fileSystem.getInfoAsync(target, {})
      if (current.exists) {
        if (current.isDirectory) throw new Error('offline_storage_invalid_file')
        await fileSystem.deleteAsync(previous, { idempotent: true })
        await fileSystem.moveAsync({ from: target, to: previous })
      }
      await fileSystem.moveAsync({ from: pending, to: target })
      await legacyStorage.removeItem(key)
    },
    async removeItem(key) {
      if (!supported && POINTER_KEY.test(key)) {
        const prefix = key.slice(0, -'.active'.length)
        if (await legacyStorage.getItem(marker(`${prefix}.g.a`)) || await legacyStorage.getItem(marker(`${prefix}.g.b`))) throw new Error('offline_storage_file_unavailable')
      }
      if (supported && GENERATION_KEY.test(key)) {
        await fileSystem.deleteAsync(file(key), { idempotent: true })
        await fileSystem.deleteAsync(`${file(key)}.pending`, { idempotent: true })
        await fileSystem.deleteAsync(`${file(key)}.previous`, { idempotent: true })
      }
      await legacyStorage.removeItem(key)
      if (GENERATION_KEY.test(key)) await legacyStorage.removeItem(marker(key))
    },
  }
}
