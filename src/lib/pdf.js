import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
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
  container.style.zIndex = '-1'
  container.style.background = '#ffffff'
  document.body.appendChild(container)

  const root = createRoot(container)

  try {
    root.render(createElement(EmailPreview, { ...previewProps, mode }))
    await waitForPaint()
    await waitForImages(container)

    const exportTarget = container.querySelector('[data-pdf-root]') || container

    const html2pdfModule = await import('html2pdf.js')
    const pdfExporter = html2pdfModule.default || html2pdfModule

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
