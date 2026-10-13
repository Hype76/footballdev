// Returning to the same screen starts a new visit and cannot revive an old PDF action.
export function createPdfVisitTracker() {
  let scope
  let generation = 0
  return {
    update(nextScope) {
      if (nextScope !== scope) { scope = nextScope; generation++ }
    },
    capture() {
      const captured = generation
      return () => captured === generation
    },
  }
}
