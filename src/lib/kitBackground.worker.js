import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { KIT_MASK_SIZE, normalizeKitMask } from './kit-background-core.js'

globalThis.onmessage = async ({ data }) => {
  let session
  try {
    env.wasm.numThreads = 1
    env.wasm.wasmPaths = { wasm: wasmUrl }
    env.wasm.proxy = false
    session = await InferenceSession.create('/models/kit-background/u2netp.onnx', { executionProviders: ['wasm'] })
    globalThis.postMessage({ status: 'processing' })
    const output = await session.run({ [session.inputNames[0]]: new Tensor('float32', data.tensor, [1, 3, KIT_MASK_SIZE, KIT_MASK_SIZE]) })
    const mask = normalizeKitMask(output[session.outputNames[0]].data)
    globalThis.postMessage({ mask }, [mask.buffer])
  } catch {
    globalThis.postMessage({ error: 'Background removal could not finish. Your original image is unchanged. Try again or keep the original.' })
  } finally { await session?.release() }
}
