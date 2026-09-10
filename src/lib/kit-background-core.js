export const KIT_MASK_SIZE = 320

export function prepareKitTensor(rgba) {
  const pixels = KIT_MASK_SIZE * KIT_MASK_SIZE
  if (rgba.length !== pixels * 4) throw new Error('Invalid kit image size.')
  let max = 1
  for (let i = 0; i < rgba.length; i += 4) max = Math.max(max, rgba[i], rgba[i + 1], rgba[i + 2])
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225]
  const tensor = new Float32Array(pixels * 3)
  for (let c = 0; c < 3; c++) for (let p = 0; p < pixels; p++) tensor[c * pixels + p] = (rgba[p * 4 + c] / max - mean[c]) / std[c]
  return tensor
}

export function normalizeKitMask(values) {
  if (values.length !== KIT_MASK_SIZE * KIT_MASK_SIZE) throw new Error('Invalid background removal result.')
  let min = Infinity, max = -Infinity
  for (const value of values) { if (!Number.isFinite(value)) throw new Error('Background removal could not identify the kit.'); min = Math.min(min, value); max = Math.max(max, value) }
  if (max - min < 0.000001) throw new Error('Background removal could not identify the kit.')
  return Uint8ClampedArray.from(values, value => Math.round((value - min) / (max - min) * 255))
}
