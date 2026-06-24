import { Buffer } from 'node:buffer'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export async function buildPdfBuffer(html) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })

  try {
    const page = await browser.newPage()

    await page.setContent(String(html ?? ''), {
      waitUntil: 'networkidle0',
    })

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
    })

    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

export async function buildPngBuffer(html, { width = 760, height = 240 } = {}) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: {
      ...(chromium.defaultViewport || {}),
      width,
      height,
    },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 2 })

    await page.setContent(String(html ?? ''), {
      waitUntil: 'networkidle0',
    })

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
      omitBackground: false,
    })

    return Buffer.from(screenshot)
  } finally {
    await browser.close()
  }
}
