import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
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

async function openMatchReportPdf(uri) {
  if (Platform.OS === 'android') {
    try {
      const contentUri = await FileSystem.getContentUriAsync(uri)
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1,
        type: 'application/pdf',
      })
      return
    } catch {
      if (!await Sharing.isAvailableAsync()) throw new Error('No PDF viewer is available on this device.')
      await Sharing.shareAsync(uri, { dialogTitle: 'View or share match report', mimeType: 'application/pdf' })
      return
    }
  }

  if (!await Sharing.isAvailableAsync()) throw new Error('This device cannot open the match report PDF.')
  await Sharing.shareAsync(uri, {
    dialogTitle: 'View or share match report',
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  })
}

export async function shareParentMobileMatchReportPdf(match = {}) {
  if (match.status !== 'full_time') throw new Error('The match report is available after full time.')
  if (!FileSystem.cacheDirectory) throw new Error('This device cannot prepare the match report PDF.')

  const filename = getCompletedReportFilename(match)
  const destination = `${FileSystem.cacheDirectory}${filename}`
  const pdfBytes = buildCompletedReportPdf(match, { audience: 'parent' })

  await FileSystem.writeAsStringAsync(destination, bytesToBase64(pdfBytes), {
    encoding: FileSystem.EncodingType.Base64,
  })
  await openMatchReportPdf(destination)
  return filename
}
