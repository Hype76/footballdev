import { requireOptionalNativeModule } from 'expo'
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'
import { buildCompletedReportPdf, getCompletedReportFilename } from '../../../src/lib/matchday-report-export.js'
import { isFinalMatchReportAvailable } from '../../../src/lib/matchday-final-report.js'
import { bytesToBase64 } from '../../mobile-core/src/offlineStorageCore.js'

export function supportsCoachMatchReportPdf() {
  return Platform.OS !== 'web' && Boolean(requireOptionalNativeModule('ExpoSharing'))
}

export async function exportCoachMatchReportPdf(match, { context, mode, isCurrent }) {
  if (!isFinalMatchReportAvailable(match) || match.deletedAt
    || Number(context?.roleRank || 0) < 20 || !context?.teamId
    || context.teamId !== match.teamId || context.clubId !== match.clubId) {
    throw new Error('Open a finished match for your active team before exporting its report.')
  }
  if (!isCurrent()) return 'cancelled'
  const filename = getCompletedReportFilename(match)
  const bytes = buildCompletedReportPdf(match, { audience: 'staff', accessContext: context })
  const base64 = bytesToBase64(bytes)

  if (Platform.OS === 'android' && mode === 'save') {
    const storage = FileSystem.StorageAccessFramework
    const permission = await storage.requestDirectoryPermissionsAsync()
    if (!permission.granted || !isCurrent()) return 'cancelled'
    const destination = await storage.createFileAsync(permission.directoryUri, filename.replace(/\.pdf$/i, ''), 'application/pdf')
    try {
      if (!isCurrent()) {
        await FileSystem.deleteAsync(destination, { idempotent: true })
        return 'cancelled'
      }
      await FileSystem.writeAsStringAsync(destination, base64, { encoding: FileSystem.EncodingType.Base64 })
      if (await FileSystem.readAsStringAsync(destination, { encoding: FileSystem.EncodingType.Base64 }) !== base64) {
        throw new Error('The PDF could not be saved to the selected folder.')
      }
    } catch (error) {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {})
      throw error
    }
    return 'saved'
  }

  const sharing = require('expo-sharing')
  if (!FileSystem.cacheDirectory || !await sharing.isAvailableAsync()) throw new Error('This device cannot share the match report PDF.')
  if (!isCurrent()) return 'cancelled'
  const directory = `${FileSystem.cacheDirectory}coach-match-report/`
  await FileSystem.deleteAsync(directory, { idempotent: true })
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
  const destination = directory + filename
  try {
    await FileSystem.writeAsStringAsync(destination, base64, { encoding: FileSystem.EncodingType.Base64 })
    const saved = await FileSystem.getInfoAsync(destination)
    if (!saved.exists || saved.size !== bytes.length) throw new Error('The match report PDF could not be prepared.')
    if (!isCurrent()) {
      await FileSystem.deleteAsync(destination, { idempotent: true })
      return 'cancelled'
    }
    await sharing.shareAsync(destination, { dialogTitle: 'Save or share match report', mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })
  } catch (error) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {})
    throw error
  }
  // The share sheet closes on both completion and cancellation.
  return 'closed'
}
