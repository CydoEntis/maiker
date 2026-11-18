/** A call that runs at once when idle, then at most once per `ms`, with a last call after the burst so the end state is always applied. */
export type Throttled = { (): void; cancel: () => void }

export function throttleTrailing(run: () => void, ms: number): Throttled {
  let last = Number.NEGATIVE_INFINITY
  let timer: number | null = null
  const call = (): void => {
    const wait = last + ms - performance.now()
    if (wait <= 0) {
      last = performance.now()
      run()
      return
    }
    // Calls inside the window collapse into one at its end.
    timer ??= window.setTimeout(() => {
      timer = null
      last = performance.now()
      run()
    }, wait)
  }
  call.cancel = () => {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
  }
  return call
}
