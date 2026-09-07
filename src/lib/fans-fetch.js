export async function fetchFansJson(url, options, fetcher = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetcher(url, { ...options, signal: controller.signal })
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(result.message || 'Fan access could not be loaded.'), { status: response.status })
    return result
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Fans could not connect. Please try again.')
    throw error
  } finally { clearTimeout(timer) }
}
