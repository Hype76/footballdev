import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'
import { buildCompletedReportPdf, getCompletedReportFilename } from '../../src/lib/matchday-report-export.js'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes) {
  let output = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0
    const group = (first << 16) | (second << 8) | third

    output += BASE64_ALPHABET[(group >>> 18) & 63]
    output += BASE64_ALPHABET[(group >>> 12) & 63]
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(group >>> 6) & 63] : '='
    output += index + 2 < bytes.length ? BASE64_ALPHABET[group & 63] : '='
  }

  return output
}

export async function saveParentMobileMatchReportPdf(match = {}) {
  if (match.status !== 'full_time') throw new Error('The match report is available after full time.')

  const filename = getCompletedReportFilename(match)
  const pdfBytes = buildCompletedReportPdf(match, { audience: 'parent' })
  const pdfBase64 = bytesToBase64(pdfBytes)

  if (Platform.OS === 'android') {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
    if (!permission.granted) return { filename, saved: false }
    const destination = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, filename.replace(/\.pdf$/i, ''), 'application/pdf')
    try {
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
  const destination = `${FileSystem.documentDirectory}${filename}`
  await FileSystem.writeAsStringAsync(destination, pdfBase64, { encoding: FileSystem.EncodingType.Base64 })
  const savedFile = await FileSystem.getInfoAsync(destination)
  if (!savedFile.exists || Number(savedFile.size || 0) < pdfBytes.length) throw new Error('The match report PDF could not be prepared.')
  if (!await Sharing.isAvailableAsync()) throw new Error('This device cannot save the PDF to Files.')
  await Sharing.shareAsync(destination, { dialogTitle: 'Save match report to Files', mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })

  return { filename, saved: false }
}
