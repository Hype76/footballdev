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
  browserLaunchTimeoutMs: 5_000,
  navigationTimeoutMs: 2_500,
  pdfTimeoutMs: 4_500,
  screenshotTimeoutMs: 4_500,
  totalRenderTimeoutMs: 8_000,
  resourceCleanupTimeoutMs: 500,
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
    return { attempted: false, closed: true, terminated: false }
  }

  let cleanupTimeoutId
  let closed = false
  let terminated = false

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
        terminated = true
      } catch {
        // The browser process may already have exited.
      }
    }
  }

  return { attempted: true, closed, terminated }
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

function installIsolationHandlers(page, diagnostics) {
  page.on('request', (request) => {
    if (diagnostics) {
      diagnostics.networkRequestCount = Number(diagnostics.networkRequestCount ?? 0) + 1
    }

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

export function countPdfPages(pdfBuffer) {
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
  diagnostics = null,
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
  let page

  if (diagnostics) {
    Object.assign(diagnostics, {
      browserLaunchResult: 'not_started',
      cleanupState: 'not_started',
      networkRequestCount: 0,
      outputBytes: 0,
      pageCount: 0,
      rendererStage: 'queued',
    })
  }

  try {
    return await withTimeout((async () => {
      if (diagnostics) {
        diagnostics.rendererStage = 'browser_launch'
      }

      browser = await launchBrowserWithCleanup(launchBrowser)

      if (diagnostics) {
        diagnostics.browserLaunchResult = 'ready'
        diagnostics.rendererStage = 'page_create'
      }

      // @sparticuz/chromium launches with --single-process. A separate browser
      // context asks Chromium to create another target and closes the browser in
      // the Netlify runtime. Each render already owns a fresh browser process,
      // so the default context remains isolated without that incompatible step.
      page = await browser.newPage()
      await page.setJavaScriptEnabled(false)
      await page.setBypassCSP(false)
      await page.setRequestInterception(true)
      page.setDefaultNavigationTimeout(PDF_RENDER_LIMITS.navigationTimeoutMs)
      page.setDefaultTimeout(PDF_RENDER_LIMITS.navigationTimeoutMs)
      installIsolationHandlers(page, diagnostics)

      if (outputType === 'png') {
        await page.setViewport({ width: 760, height: 240, deviceScaleFactor: 2 })
      }

      if (diagnostics) {
        diagnostics.rendererStage = 'document_render'
      }

      await page.setContent(renderPdfDocumentHtml(validatedDocument), {
        waitUntil: 'domcontentloaded',
        timeout: PDF_RENDER_LIMITS.navigationTimeoutMs,
      })

      // Use the browser global explicitly. Bundlers may rename the renderer's
      // `document` parameter and accidentally rewrite a bare `document`
      // reference inside this serialized page callback.
      const scrollHeight = await page.evaluate(() => globalThis.document.documentElement.scrollHeight)
      const estimatedPages = Math.max(1, Math.ceil(Number(scrollHeight || 0) / 1123))

      if (outputType === 'pdf' && estimatedPages > PDF_RENDER_LIMITS.maxPages) {
        throw rendererError('PDF_PAGE_LIMIT_EXCEEDED', 413)
      }

      if (outputType === 'png') {
        if (diagnostics) {
          diagnostics.rendererStage = 'png_output'
        }

        const screenshot = await withTimeout(
          page.screenshot({ type: 'png', fullPage: true, omitBackground: false }),
          PDF_RENDER_LIMITS.screenshotTimeoutMs,
        )
        const output = validatePngOutput(Buffer.from(screenshot))

        if (diagnostics) {
          diagnostics.outputBytes = output.length
          diagnostics.rendererStage = 'output_ready'
        }

        return output
      }

      if (diagnostics) {
        diagnostics.rendererStage = 'pdf_output'
      }

      const pdf = await withTimeout(
        page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }),
        PDF_RENDER_LIMITS.pdfTimeoutMs,
      )
      const output = validatePdfOutput(Buffer.from(pdf))

      if (diagnostics) {
        diagnostics.outputBytes = output.length
        diagnostics.pageCount = countPdfPages(output)
        diagnostics.rendererStage = 'output_ready'
      }

      return output
    })(), timeoutMs)
  } catch (error) {
    if (diagnostics) {
      diagnostics.failureCategory = String(error?.code || error?.name || 'PDF_RENDER_FAILED')
    }

    throw error
  } finally {
    const pageCleanup = await closeQuietly(page)
    const browserCleanup = await closeQuietly(browser, { terminateProcess: true })

    if (diagnostics) {
      diagnostics.cleanupState =
        pageCleanup.closed && browserCleanup.closed
          ? 'complete'
          : browserCleanup.terminated
            ? 'forced'
            : 'incomplete'
      diagnostics.rendererStage =
        diagnostics.rendererStage === 'output_ready'
          ? 'complete'
          : diagnostics.rendererStage
    }

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
