import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'
import { buildCompletedReportPdf, getCompletedReportFilename } from '../../src/lib/matchday-report-export.js'
import { bytesToBase64, prepareParentPdfLogo } from './src/parentPdfLogo.js'

export async function saveParentMobileMatchReportPdf(match = {}, { storageOrigin, isCurrent = () => true } = {}) {
  if (match.status !== 'full_time') throw new Error('The match report is available after full time.')

  const filename = getCompletedReportFilename(match)
  const cancelled = { filename, saved: false }
  if (!isCurrent()) return cancelled
  const branding = await prepareParentPdfLogo(match, { storageOrigin })
  if (!isCurrent()) return cancelled
  const pdfBytes = buildCompletedReportPdf(match, { audience: 'parent', branding, accessContext: match })
  const pdfBase64 = bytesToBase64(pdfBytes)

  if (Platform.OS === 'android') {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
    if (!permission.granted || !isCurrent()) return cancelled
    const destination = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, filename.replace(/\.pdf$/i, ''), 'application/pdf')
    try {
      if (!isCurrent()) {
        await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {})
        return cancelled
      }
      await FileSystem.writeAsStringAsync(destination, pdfBase64, { encoding: FileSystem.EncodingType.Base64 })
      const savedBase64 = await FileSystem.readAsStringAsync(destination, { encoding: FileSystem.EncodingType.Base64 })
      if (savedBase64 !== pdfBase64) throw new Error('The PDF could not be saved to the selected folder.')
    } catch (error) {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {})
      throw error
    }
    return { filename, saved: true }
  }

  if (!FileSystem.documentDirectory) throw new Error('This device cannot prepare the match report PDF.')
  if (!await Sharing.isAvailableAsync()) throw new Error('This device cannot save or share the PDF.')
  if (!isCurrent()) return cancelled
  const destination = `${FileSystem.documentDirectory}${filename}`
  try {
    await FileSystem.writeAsStringAsync(destination, pdfBase64, { encoding: FileSystem.EncodingType.Base64 })
    const savedFile = await FileSystem.getInfoAsync(destination)
    if (!savedFile.exists || Number(savedFile.size || 0) !== pdfBytes.length) throw new Error('The match report PDF could not be prepared.')
    const savedBase64 = await FileSystem.readAsStringAsync(destination, { encoding: FileSystem.EncodingType.Base64 })
    if (savedBase64 !== pdfBase64) throw new Error('The match report PDF could not be prepared.')
  } catch (error) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {})
    throw error
  }
  if (!isCurrent()) return cancelled
  await Sharing.shareAsync(destination, { dialogTitle: 'Save match report to Files', mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })

  // iOS resolves sharing after both completion and cancellation, without a save result.
  return { filename, saved: false }
}
