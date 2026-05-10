import { createContext, useContext } from 'react'

export const WalkthroughContext = createContext(null)

export function useWalkthrough() {
  return useContext(WalkthroughContext)
}
