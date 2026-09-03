export async function runPrioritizedMobileLoads(loaders, {
  priority = [], concurrency = 4, onSettled = () => {},
} = {}) {
  const names = [...new Set([...priority, ...Object.keys(loaders)])].filter((name) => loaders[name])
  const results = {}
  let next = 0
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++]
      try {
        results[name] = { status: 'fulfilled', value: await loaders[name]() }
      } catch (reason) {
        results[name] = { status: 'rejected', reason }
      }
      onSettled(name, results[name], results)
    }
  }
  await Promise.all(Array.from({ length: Math.min(names.length, Math.max(1, concurrency)) }, worker))
  return results
}
