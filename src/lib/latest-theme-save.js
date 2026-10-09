// Serialize writes so the final server preference matches the latest selection.
// Superseded requests may finish, but cannot update account state or notices.
export function createLatestThemeSave() {
  let revision = 0
  let queue = Promise.resolve()

  return {
    cancel() {
      revision += 1
    },
    save({ persist, onSuccess, onError }) {
      const request = ++revision
      const result = queue.then(async () => {
        if (request !== revision) return
        let profile
        try {
          profile = await persist()
        } catch (error) {
          if (request === revision) onError(error)
          return
        }
        if (request === revision) onSuccess(profile)
      })
      queue = result.catch(() => {})
      return result
    },
  }
}
