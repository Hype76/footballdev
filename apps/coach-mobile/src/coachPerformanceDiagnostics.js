import AsyncStorage from '@react-native-async-storage/async-storage'
import { createCoachPerformanceDiagnostics, createCoachStartupTiming, getCoachConnectionLabel as readConnectionLabel } from './coachPerformanceDiagnosticsCore'

const diagnostics = createCoachPerformanceDiagnostics({ storage: AsyncStorage })
export const recordCoachStartupScreen = createCoachStartupTiming({ record: diagnostics.record })

export function recordCoachPerformanceSample(sample) {
  diagnostics.record(sample)
}

export async function readCoachPerformanceSamples() {
  return diagnostics.read()
}

export async function clearCoachPerformanceSamples() {
  return diagnostics.clear()
}

export function getCoachConnectionLabel() {
  return readConnectionLabel()
}
