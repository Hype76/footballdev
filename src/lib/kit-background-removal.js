import { KIT_MASK_SIZE, prepareKitTensor } from './kit-background-core.js'

export function removeKitBackground(image, onProgress = () => {}) {
  const sample = document.createElement('canvas')
  sample.width = sample.height = KIT_MASK_SIZE
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  sampleContext.fillStyle = '#ffffff'
  sampleContext.fillRect(0, 0, KIT_MASK_SIZE, KIT_MASK_SIZE)
  sampleContext.drawImage(image, 0, 0, KIT_MASK_SIZE, KIT_MASK_SIZE)
  const tensor = prepareKitTensor(sampleContext.getImageData(0, 0, KIT_MASK_SIZE, KIT_MASK_SIZE).data)
  const worker = new Worker(new URL('./kitBackground.worker.js', import.meta.url), { type: 'module' })
  let rejectJob, timer, settled = false
  const stop = () => { worker.terminate(); clearTimeout(timer) }
  const promise = new Promise((resolve, reject) => {
    rejectJob = reject
    timer = setTimeout(() => { settled = true; stop(); reject(new Error('Background removal took too long. Your original is unchanged. Try a smaller image.')) }, 120000)
    worker.onerror = () => { settled = true; stop(); reject(new Error('Background removal is unavailable in this browser. Your original is unchanged.')) }
    worker.onmessage = async ({ data }) => {
      if (settled) return
      if (data.status) { onProgress('Removing background...'); return }
      settled = true; stop()
      if (data.error) { reject(new Error(data.error)); return }
      try {
        const maskCanvas = document.createElement('canvas')
        maskCanvas.width = maskCanvas.height = KIT_MASK_SIZE
        const maskContext = maskCanvas.getContext('2d')
        const maskImage = maskContext.createImageData(KIT_MASK_SIZE, KIT_MASK_SIZE)
        for (let i = 0; i < data.mask.length; i++) { maskImage.data[i * 4] = 255; maskImage.data[i * 4 + 1] = 255; maskImage.data[i * 4 + 2] = 255; maskImage.data[i * 4 + 3] = data.mask[i] }
        maskContext.putImageData(maskImage, 0, 0)
        const output = document.createElement('canvas')
        const scale = Math.min(1, 1024 / Math.max(image.width, image.height))
        output.width = Math.max(1, Math.round(image.width * scale)); output.height = Math.max(1, Math.round(image.height * scale))
        const context = output.getContext('2d')
        context.drawImage(image, 0, 0, output.width, output.height)
        context.globalCompositeOperation = 'destination-in'
        context.drawImage(maskCanvas, 0, 0, output.width, output.height)
        const blob = await new Promise(done => output.toBlob(done, 'image/png'))
        if (!blob) throw new Error('The preview could not be created. Your original is unchanged.')
        resolve(blob)
      } catch (error) { reject(error) }
    }
    worker.postMessage({ tensor }, [tensor.buffer])
  })
  return { promise, cancel: () => { if (!settled) { settled = true; stop(); rejectJob(new DOMException('Cancelled', 'AbortError')) } } }
}
