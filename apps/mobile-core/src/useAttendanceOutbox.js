import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import * as Crypto from 'expo-crypto'
import { createAttendanceOutbox, projectAttendanceChoice } from './attendanceOutboxCore'
import { executeAttendanceCommand } from './attendanceCommandData'

export function useAttendanceUiGuard(scope) {
  const current = useRef(null)
  useLayoutEffect(() => {
    const token = { scope, mounted: true }
    current.current = token
    return () => { token.mounted = false }
  }, [scope])
  return useCallback(() => {
    const token = current.current
    return () => token?.scope === scope && token === current.current && token.mounted
  }, [scope])
}

export function useAttendanceOutbox({ scope, read, update, notify, onConfirmed }) {
  const [state, setState] = useState({ scope, commands: [], provisional: [], error: '' })
  const current = useRef(null)
  // Scope ownership changes only when React commits. An abandoned render must
  // never invalidate the committed account or revive an earlier scope's work.
  useLayoutEffect(() => {
    const token = { scope, active: true, online: false, lastSaved: '' }
    const isCurrent = () => token.active && current.current === token
    token.isCurrent = isCurrent
    token.engine = createAttendanceOutbox({ scope, isCurrent, makeId: () => Crypto.randomUUID(),
      read: () => token.read(), update: change => token.update(change),
      execute: executeAttendanceCommand,
      notify: (command, receipt) => token.notify?.(command, receipt),
      canSend: () => isCurrent() && token.online && AppState.currentState === 'active',
      onReaction: command => {
        if (isCurrent()) setState(previous => ({ ...previous, scope, provisional: [...(previous.scope === scope ? previous.provisional : []), command], error: '' }))
      },
      onChange: commands => {
        if (!isCurrent()) return
        setState(previous => ({ scope, commands, provisional: previous.scope === scope
          ? previous.provisional.filter(command => !commands.some(entry => entry.id === command.id)) : [], error: '' }))
        const saved = commands.filter(command => command.status === 'saved').map(command => command.id).join(':')
        if (saved && token.lastSaved !== saved) {
          token.lastSaved = saved
          Promise.resolve(token.onConfirmed?.()).catch(() => {})
        }
      },
    })
    current.current = token
    return () => { token.active = false }
  }, [scope])
  useLayoutEffect(() => {
    const token = current.current
    if (token?.active && token.scope === scope) Object.assign(token, { read, update, notify, onConfirmed })
  }, [scope, read, update, notify, onConfirmed])
  useEffect(() => {
    const token = current.current
    if (!token?.isCurrent() || token.scope !== scope) return undefined
    const recover = () => {
      if (!token.isCurrent()) return Promise.resolve()
      return token.engine.recover().then(() => token.isCurrent() ? token.engine.sync() : undefined).catch(() => {
        if (token.isCurrent()) setState(previous => ({ ...previous, scope, error: 'Saved attendance could not be opened. Reopen this workspace before responding.' }))
      })
    }
    void recover()
    const network = NetInfo.addEventListener(value => {
      if (!token.isCurrent()) return
      token.online = value.isConnected === true && value.isInternetReachable !== false
      if (token.online) void recover()
    })
    const app = AppState.addEventListener('change', value => { if (value === 'active') void recover() })
    const interval = setInterval(() => { if (token.online && AppState.currentState === 'active') void recover() }, 30000)
    return () => { network(); app.remove(); clearInterval(interval) }
  }, [scope])
  const capture = () => {
    const token = current.current
    if (!token?.isCurrent() || token.scope !== scope) throw new Error('The attendance account changed. Reopen the original workspace.')
    return token
  }
  const commands = state.scope === scope ? [...state.commands, ...state.provisional] : []
  return { commands, error: state.scope === scope ? state.error : '',
    project: item => projectAttendanceChoice(item, commands, scope),
    enqueue: async (preparation, response, label) => {
      const token = capture()
      try { return await token.engine.enqueue(preparation, response, label) }
      catch (error) {
        if (token.isCurrent()) setState(previous => ({ ...previous, scope, provisional: [], error: error.message || 'This answer could not be saved on the phone. The screen remains open.' }))
        throw error
      }
    },
    retry: () => {
      const token = capture()
      return token.engine.sync({ explicitRetry: true }).catch(error => {
        if (token.isCurrent()) setState(previous => ({ ...previous, error: error.message || 'Saved attendance could not sync. Retry when connected.' }))
      })
    },
    review: id => {
      const token = capture()
      return token.engine.review(id).catch(error => {
        if (token.isCurrent()) setState(previous => ({ ...previous, error: error.message || 'This answer still needs review.' }))
      })
    } }
}
