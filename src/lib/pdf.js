import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { EmailPreview } from '../components/ui/EmailPreview.jsx'

function waitForPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve)
    })
  })
}

async function waitForImages(element) {
  const images = Array.from(element.querySelectorAll('img'))

  await Promise.all(
    images.map((image) => {
      if (image.complete) {
        return Promise.resolve()
      }

      return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true })
        image.addEventListener('error', resolve, { once: true })
      })
    }),
  )
}

async function resolvePdfLogoUrl(logoUrl) {
  const normalizedLogoUrl = String(logoUrl ?? '').trim()

  if (!normalizedLogoUrl) {
    return fallbackLogo
  }

  try {
    const parsedUrl = new URL(normalizedLogoUrl, window.location.origin)

    if (parsedUrl.origin === window.location.origin || parsedUrl.hostname.endsWith('.supabase.co')) {
      return parsedUrl.toString()
    }

    const response = await fetch(parsedUrl.toString(), { mode: 'cors' })

    if (!response.ok) {
      throw new Error(`Logo request failed with status ${response.status}.`)
    }

    const blob = await response.blob()

    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result || fallbackLogo))
      reader.onerror = () => reject(new Error('Could not read the uploaded logo.'))
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.error('Falling back to default PDF logo.', error)
    return fallbackLogo
  }
}

export function buildEvaluationSummary(evaluation) {
  const responseEntries = Object.entries(evaluation.formResponses ?? {})

  if (responseEntries.length > 0) {
    return responseEntries
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')
  }

  return (
    evaluation.comments?.overall ||
    evaluation.comments?.strengths ||
    evaluation.comments?.improvements ||
    'No written summary provided.'
  )
}

export async function exportEvaluationPdf({
  filename,
  previewProps,
  mode = 'scored',
}) {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = '794px'
  container.style.opacity = '0'
  container.style.pointerEvents = 'none'
  container.style.zIndex = '-1'
  container.style.background = '#ffffff'
  document.body.appendChild(container)

  const root = createRoot(container)

  try {
    const safeLogoUrl = await resolvePdfLogoUrl(previewProps?.logoUrl)

    flushSync(() => {
      root.render(
        createElement(EmailPreview, {
          ...previewProps,
          logoUrl: safeLogoUrl,
          mode,
        }),
      )
    })

    await waitForPaint()
    await waitForImages(container)

    const exportTarget = container.querySelector('[data-pdf-root]') || container

    const html2pdfModule = await import('html2pdf.js')
    const pdfExporter = html2pdfModule.default || html2pdfModule

    if (typeof pdfExporter !== 'function') {
      throw new Error('PDF exporter did not load correctly.')
    }

    await pdfExporter()
      .set({
        margin: [8, 8, 8, 8],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          logging: false,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      })
      .from(exportTarget)
      .save()
  } finally {
    root.unmount()
    container.remove()
  }
}
