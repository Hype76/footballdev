import { useCallback, useRef } from 'react'

export function useMobileActionRunner({ setActiveActionId, setStatusMessage }) {
  const activeActionRef = useRef('')

  return useCallback(async (actionId, action, { errorMessage, successMessage } = {}) => {
    if (activeActionRef.current) {
      return null
    }

    activeActionRef.current = actionId
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
      if (activeActionRef.current === actionId) {
        activeActionRef.current = ''
      }

      setActiveActionId('')
    }
  }, [setActiveActionId, setStatusMessage])
}
