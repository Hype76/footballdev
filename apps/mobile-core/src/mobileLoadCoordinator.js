export async function runPrioritizedMobileLoads(loaders, {
  priority = [], concurrency = 4, onSettled = () => {}, afterLoad = {},
} = {}) {
  const names = [...new Set([...priority, ...Object.keys(loaders)])].filter((name) => loaders[name])
  const results = {}
  const followUps = []
  const settle = (name, result) => {
    results[name] = result
    onSettled(name, result, results)
  }
  let next = 0
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++]
      let value
      try {
        value = await loaders[name]()
      } catch (reason) {
        settle(name, { status: 'rejected', reason })
        continue
      }
      if (afterLoad[name]) {
        // Dependencies shared by several results must not hold a loader slot.
        followUps.push(Promise.resolve().then(() => afterLoad[name](value)).then(
          (value) => settle(name, { status: 'fulfilled', value }),
          (reason) => settle(name, { status: 'rejected', reason }),
        ))
      } else {
        settle(name, { status: 'fulfilled', value })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(names.length, Math.max(1, concurrency)) }, worker))
  await Promise.all(followUps)
  return results
}
