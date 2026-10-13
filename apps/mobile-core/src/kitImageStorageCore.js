const MAX_BYTES = 10 * 1024 * 1024

export function createKitImageStorage({ fileSystem, digest, origin }) {
  const pending = new Map()
  function approved(uri) {
    try {
      const url = new URL(uri)
      return url.protocol === 'https:' && url.origin === new URL(origin).origin && !url.username && !url.password
        && url.pathname.startsWith('/storage/v1/object/public/club-kits/') && !url.search && !url.hash
    } catch { return false }
  }
  function valid(info) { return info?.exists && !info.isDirectory && info.size > 0 && info.size <= MAX_BYTES }
  async function resolve(uri) {
    if (!approved(uri)) return uri || ''
    if (!fileSystem?.documentDirectory || !['getInfoAsync', 'makeDirectoryAsync', 'downloadAsync', 'moveAsync', 'deleteAsync'].every(method => typeof fileSystem[method] === 'function')) return uri
    const key = await digest(uri)
    if (!/^[a-f0-9]{64}$/.test(key)) return uri
    const directory = `${fileSystem.documentDirectory.replace(/\/*$/, '')}/fp-kit-art-v1/`
    const local = `${directory}${key}.image`, temporary = `${directory}${key}.pending`
    try {
      if (valid(await fileSystem.getInfoAsync(local, {}))) return local
      await fileSystem.makeDirectoryAsync(directory, { intermediates: true })
      const result = await fileSystem.downloadAsync(uri, temporary, { sessionType: 0 })
      const type = Object.entries(result?.headers || {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || result?.mimeType
      if (result?.status !== 200 || !/^image\/(png|jpeg|webp|gif)(?:;|$)/i.test(type || '') || !valid(await fileSystem.getInfoAsync(temporary, {}))) throw new Error('Kit artwork could not be saved.')
      await fileSystem.moveAsync({ from: temporary, to: local })
      return local
    } catch {
      return uri
    } finally {
      await fileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => {})
    }
  }
  return {
    resolve(uri) {
      if (!uri) return Promise.resolve('')
      if (pending.has(uri)) return pending.get(uri)
      const result = resolve(uri).catch(() => uri).finally(() => { if (pending.get(uri) === result) pending.delete(uri) })
      pending.set(uri, result)
      return result
    },
  }
}
