import {
  detectSpreadsheetFormat,
  inspectSpreadsheetSource,
} from './_data-transfer-tabular.js'
import { inspectTransferWorkbookMode } from './_data-transfer-workbook.js'

export async function inspectDataTransferSource(buffer, options = {}) {
  const format = await detectSpreadsheetFormat(buffer, options)
  if (format === 'xlsx') {
    const workbookMode = await inspectTransferWorkbookMode(buffer)
    if (workbookMode.portable) return workbookMode
  }

  const ordinary = await inspectSpreadsheetSource(buffer, options)
  return {
    ...ordinary,
    importMode: 'ordinary',
    portable: false,
    modeDetection: {
      mode: 'ordinary',
      signature: null,
    },
  }
}
