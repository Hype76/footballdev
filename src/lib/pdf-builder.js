import { Buffer } from 'node:buffer'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import {
  PDF_REPORT_TYPES,
  buildProgressionChartDocument,
  renderPdfDocumentHtml,
  validatePdfDocument,
} from './pdf-document.js'

export const PDF_RENDER_LIMITS = Object.freeze({
  browserLaunchTimeoutMs: 8_000,
  navigationTimeoutMs: 4_000,
  pdfTimeoutMs: 10_000,
  screenshotTimeoutMs: 8_000,
  totalRenderTimeoutMs: 15_000,
  resourceCleanupTimeoutMs: 1_000,
  maxPdfBytes: 5 * 1024 * 1024,
  maxPngBytes: 2 * 1024 * 1024,
  maxPages: 20,
  maxConcurrentRenders: 2,
})

export class PdfRendererError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message)
    this.name = 'PdfRendererError'
    this.code = code
    this.statusCode = statusCode
  }
}

let activeRenderCount = 0

function rendererError(code, statusCode = 400) {
  const messages = {
    PDF_BUSY: 'PDF rendering is busy. Try again shortly.',
    PDF_RENDER_TIMEOUT: 'PDF rendering timed out.',
    PDF_OUTPUT_INVALID: 'PDF rendering did not produce a valid file.',
    PDF_OUTPUT_TOO_LARGE: 'The generated PDF is too large.',
    PDF_PAGE_LIMIT_EXCEEDED: 'The generated PDF has too many pages.',
  }

  return new PdfRendererError(messages[code] || 'PDF rendering failed.', code, statusCode)
}

function withTimeout(promise, timeoutMs, code = 'PDF_RENDER_TIMEOUT') {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(rendererError(code, code === 'PDF_BUSY' ? 429 : 504)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

async function closeQuietly(resource, { terminateProcess = false } = {}) {
  if (!resource?.close) {
    return
  }

  let cleanupTimeoutId
  let closed = false

  try {
    await Promise.race([
      Promise.resolve(resource.close()).then(() => {
        closed = true
      }),
      new Promise((_, reject) => {
        cleanupTimeoutId = setTimeout(
          () => reject(new Error('PDF renderer cleanup timed out.')),
          PDF_RENDER_LIMITS.resourceCleanupTimeoutMs,
        )
      }),
    ])
  } catch {
    // Cleanup is best effort after the render outcome is already known.
  } finally {
    clearTimeout(cleanupTimeoutId)

    if (!closed && terminateProcess) {
      try {
        resource.process?.()?.kill?.('SIGKILL')
      } catch {
        // The browser process may already have exited.
      }
    }
  }
}

async function launchChromium() {
  const safeArguments = [
    ...chromium.args,
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-features=ServiceWorker',
    '--disable-sync',
    '--no-default-browser-check',
    '--no-first-run',
  ]

  return puppeteer.launch({
    args: [...new Set(safeArguments)],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    timeout: PDF_RENDER_LIMITS.browserLaunchTimeoutMs,
  })
}

async function launchBrowserWithCleanup(launchBrowser) {
  const launchPromise = Promise.resolve().then(() => launchBrowser())

  try {
    return await withTimeout(launchPromise, PDF_RENDER_LIMITS.browserLaunchTimeoutMs)
  } catch (error) {
    void launchPromise
      .then((lateBrowser) => closeQuietly(lateBrowser, { terminateProcess: true }))
      .catch(() => {})
    throw error
  }
}

function installIsolationHandlers(page) {
  page.on('request', (request) => {
    if (!request.isInterceptResolutionHandled?.()) {
      void request.abort('blockedbyclient')
    }
  })
  page.on('popup', (popup) => {
    void closeQuietly(popup)
  })
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => {})
  })
}

function countPdfPages(pdfBuffer) {
  return (pdfBuffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length
}

function validatePdfOutput(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 5 || pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw rendererError('PDF_OUTPUT_INVALID', 500)
  }

  if (pdfBuffer.length > PDF_RENDER_LIMITS.maxPdfBytes) {
    throw rendererError('PDF_OUTPUT_TOO_LARGE', 413)
  }

  const pageCount = countPdfPages(pdfBuffer)

  if (pageCount < 1 || pageCount > PDF_RENDER_LIMITS.maxPages) {
    throw rendererError('PDF_PAGE_LIMIT_EXCEEDED', 413)
  }

  return pdfBuffer
}

function validatePngOutput(pngBuffer) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length < pngSignature.length || !pngBuffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw rendererError('PDF_OUTPUT_INVALID', 500)
  }

  if (pngBuffer.length > PDF_RENDER_LIMITS.maxPngBytes) {
    throw rendererError('PDF_OUTPUT_TOO_LARGE', 413)
  }

  return pngBuffer
}

async function renderInIsolatedBrowser(document, {
  launchBrowser = launchChromium,
  outputType = 'pdf',
  timeoutMs = PDF_RENDER_LIMITS.totalRenderTimeoutMs,
} = {}) {
  const validatedDocument = validatePdfDocument(document)

  if (activeRenderCount >= PDF_RENDER_LIMITS.maxConcurrentRenders) {
    throw rendererError('PDF_BUSY', 429)
  }

  activeRenderCount += 1
  let browser
  let context
  let page

  try {
    return await withTimeout((async () => {
      browser = await launchBrowserWithCleanup(launchBrowser)
      context = await browser.createBrowserContext()
      page = await context.newPage()
      await page.setJavaScriptEnabled(false)
      await page.setBypassCSP(false)
      await page.setRequestInterception(true)
      page.setDefaultNavigationTimeout(PDF_RENDER_LIMITS.navigationTimeoutMs)
      page.setDefaultTimeout(PDF_RENDER_LIMITS.navigationTimeoutMs)
      installIsolationHandlers(page)

      if (outputType === 'png') {
        await page.setViewport({ width: 760, height: 240, deviceScaleFactor: 2 })
      }

      await page.setContent(renderPdfDocumentHtml(validatedDocument), {
        waitUntil: 'domcontentloaded',
        timeout: PDF_RENDER_LIMITS.navigationTimeoutMs,
      })

      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      const estimatedPages = Math.max(1, Math.ceil(Number(scrollHeight || 0) / 1123))

      if (outputType === 'pdf' && estimatedPages > PDF_RENDER_LIMITS.maxPages) {
        throw rendererError('PDF_PAGE_LIMIT_EXCEEDED', 413)
      }

      if (outputType === 'png') {
        const screenshot = await withTimeout(
          page.screenshot({ type: 'png', fullPage: true, omitBackground: false }),
          PDF_RENDER_LIMITS.screenshotTimeoutMs,
        )
        return validatePngOutput(Buffer.from(screenshot))
      }

      const pdf = await withTimeout(
        page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }),
        PDF_RENDER_LIMITS.pdfTimeoutMs,
      )
      return validatePdfOutput(Buffer.from(pdf))
    })(), timeoutMs)
  } finally {
    await closeQuietly(page)
    await closeQuietly(context)
    await closeQuietly(browser, { terminateProcess: true })
    activeRenderCount -= 1
  }
}

export function buildPdfBuffer(document, options) {
  return renderInIsolatedBrowser(document, { ...options, outputType: 'pdf' })
}

export function buildProgressionChartPngBuffer(points, options) {
  const document = buildProgressionChartDocument(points)
  return renderInIsolatedBrowser(document, { ...options, outputType: 'png' })
}

export function getActivePdfRenderCount() {
  return activeRenderCount
}

export function isNetworkRequestAllowed() {
  return false
}

export { PDF_REPORT_TYPES }
