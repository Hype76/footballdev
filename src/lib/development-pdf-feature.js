export const DEVELOPMENT_PDF_CLIENT_FLAG = 'VITE_ENABLE_DEVELOPMENT_PDF'
export const DEVELOPMENT_PDF_SERVER_FLAG = 'ENABLE_DEVELOPMENT_PDF'

function isTrueFlag(value) {
  return String(value ?? '').trim().toLowerCase() === 'true'
}

export function isDevelopmentPdfClientEnabled(env = {}) {
  return isTrueFlag(env?.[DEVELOPMENT_PDF_CLIENT_FLAG])
}

export function isDevelopmentPdfServerEnabled(env = {}) {
  return isTrueFlag(env?.[DEVELOPMENT_PDF_SERVER_FLAG])
}
