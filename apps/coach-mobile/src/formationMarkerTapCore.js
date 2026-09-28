export function createFormationMarkerTapRecognizer({ onSingleTap, onTripleTap, schedule = setTimeout, cancelTimer = clearTimeout, windowMs = 400 }) {
  let count = 0
  let timer = null
  const cancel = () => {
    if (timer !== null) cancelTimer(timer)
    timer = null
    count = 0
  }
  return {
    cancel,
    tap() {
      count += 1
      if (timer !== null) cancelTimer(timer)
      if (count === 3) {
        timer = null
        count = 0
        onTripleTap()
        return
      }
      timer = schedule(() => {
        timer = null
        count = 0
        onSingleTap()
      }, windowMs)
    },
  }
}
