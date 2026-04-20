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
  container.style.width = '900px'
  container.style.zIndex = '-1'
  document.body.appendChild(container)

  const root = createRoot(container)

  try {
    root.render(createElement(EmailPreview, { ...previewProps, mode }))
    await waitForPaint()

    const html2pdfModule = await import('html2pdf.js')
    const pdfExporter = html2pdfModule.default || html2pdfModule

    await pdfExporter()
      .set({
        margin: 10,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(container)
      .save()
  } finally {
    root.unmount()
    container.remove()
  }
}
