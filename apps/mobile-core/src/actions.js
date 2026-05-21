import { useCallback } from 'react'

export function useMobileActionRunner({ setActiveActionId, setStatusMessage }) {
  return useCallback(async (actionId, action, { errorMessage, successMessage } = {}) => {
    setActiveActionId(actionId)
    setStatusMessage('')

    try {
      const result = await action()
      const resolvedSuccessMessage = typeof successMessage === 'function'
        ? successMessage(result)
        : successMessage

      if (resolvedSuccessMessage) {
        setStatusMessage(resolvedSuccessMessage)
      }

      return result
    } catch (error) {
      console.error(error)
      setStatusMessage(error.message || errorMessage || 'Action could not be completed.')
      return null
    } finally {
      setActiveActionId('')
    }
  }, [setActiveActionId, setStatusMessage])
}
