let webgl2Available: boolean | null = null

/**
 * Whether the web view can draw with WebGL 2. Asked once per page: it is a property of the web
 * view, not of a pane. Without it the terminal falls back to xterm's DOM renderer, and the window
 * drops the glass finish's shadows, gradients and blur, which a software rasteriser repaints at
 * full cost on every frame (docs/PERFORMANCE.md).
 */
export function hasWebgl2(): boolean {
  webgl2Available ??= document.createElement('canvas').getContext('webgl2') !== null
  return webgl2Available
}

/**
 * Whether this is WebKitGTK, the Linux web view. Its user agent names X11 and Linux, with the distribution between
 * them in a bundled build (`X11; Ubuntu; Linux`); Android's and the test environment's name neither.
 */
export function isLinuxWebView(userAgent: string = navigator.userAgent): boolean {
  return /X11;.*Linux/.test(userAgent)
}

export type GpuKind = 'webgl' | 'software'

export function gpuKind(): GpuKind {
  return hasWebgl2() ? 'webgl' : 'software'
}

/** Frames the probe times, and the frame time past which one counts as slow (a 60 Hz frame is 16.7ms). */
export const PROBE_FRAMES = 6
export const SLOW_FRAME_MS = 24
/** At least this share of the frames (one in this many) must be slow. */
const SLOW_SHARE_DIVISOR = 2
/** The probe waits for the first draws of the window to be over, so startup work is not read as a slow painter. */
export const PROBE_DELAY_MS = 1500

/**
 * Whether these frame times are those of a software painter: at least half were slow, so one hiccup (a garbage
 * collection, a window being dragged) does not make a machine with a GPU look like one without. A WebKitGTK window
 * reports WebGL 2 even when it paints on the CPU, so what the page really costs has to be timed.
 */
export function framesAreSlow(frameMs: readonly number[]): boolean {
  if (frameMs.length === 0) return false
  return frameMs.filter((ms) => ms > SLOW_FRAME_MS).length * SLOW_SHARE_DIVISOR >= frameMs.length
}

/** Times `PROBE_FRAMES` frames while a 1px element moves by transform (the cheapest animation there is), and says whether they were slow. */
export function probeFrames(): Promise<boolean> {
  return new Promise((resolve) => {
    const dot = document.createElement('div')
    dot.setAttribute('aria-hidden', 'true')
    dot.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;pointer-events:none;opacity:.01'
    document.body.append(dot)
    const move = typeof dot.animate === 'function' ? dot.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(2px)' }], { duration: 400, iterations: Infinity, direction: 'alternate' }) : null
    const frames: number[] = []
    let last: number | null = null
    const step = (now: number) => {
      if (last !== null) frames.push(now - last)
      last = now
      if (frames.length < PROBE_FRAMES) { requestAnimationFrame(step); return }
      move?.cancel()
      dot.remove()
      resolve(framesAreSlow(frames))
    }
    requestAnimationFrame(step)
  })
}

/** Marks the document for the stylesheet: `data-gpu` is `webgl` or `software`. */
export function markGpu(): void {
  document.documentElement.dataset.gpu = gpuKind()
  // WebKitGTK says it has WebGL 2 on machines that paint on the CPU: ask the frames. Only the Linux web view needs it.
  if (gpuKind() === 'webgl' && isLinuxWebView() && typeof requestAnimationFrame === 'function') {
    window.setTimeout(() => {
      if (document.hidden) return
      void probeFrames().then((slow) => { if (slow) document.documentElement.dataset.gpu = 'software' })
    }, PROBE_DELAY_MS)
  }
}
