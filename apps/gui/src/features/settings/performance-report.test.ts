import { describe, expect, it } from 'vitest'
import { buildPerformanceReport, formatMemory, formatRate, type PerformanceEnvironment } from './performance-report'

const ENVIRONMENT: PerformanceEnvironment = { version: '0.64.0', userAgent: 'WebKit test', gpu: 'webgl', reduceMotion: false, terminalFontSize: 14 }

describe('performance report', () => {
  it('formats sizes in binary units', () => {
    expect(formatMemory(512)).toBe('1 KiB')
    expect(formatMemory(3 * 1024 * 1024)).toBe('3 MiB')
    expect(formatRate(900)).toBe('900 B/s')
    expect(formatRate(20 * 1024)).toBe('20.0 KiB/s')
  })

  it('lists the samples and every process', () => {
    const report = buildPerformanceReport(
      ENVIRONMENT,
      { visible: true, framesPerSecond: 60, slowFrames: 2, worstFrameMs: 80, outputBytesPerSecond: 2048, outputFramesPerSecond: 4, outputFramesTotal: 40, socketFramesTotal: 38, flushesPerSecond: 3, writeLatencyMs: 5, animations: 1, domNodes: 900, renderers: { webgl: 2, dom: 0 }, keyReplies: { count: 40, medianMs: 3, worstMs: 410 } },
      {
        cores: 8,
        host: { pid: 10, name: 'host', command: 'host', cpu: 2, memory_bytes: 1024 * 1024 },
        webview: [{ pid: 11, name: 'WebKitWebProcess', command: '', cpu: 13.4, memory_bytes: 2 * 1024 * 1024 }],
        daemons: [{ pid: 12, name: 'daemon', command: '/usr/bin/daemon daemon', cpu: 0.5, memory_bytes: 1024 }],
        terminal_frames_sent: 41,
      },
    )
    expect(report).toContain('frames/s 60; slow frames 2; worst frame 80 ms')
    expect(report).toContain('2 WebGL, 0 DOM')
    expect(report).toContain('output 2.0 KiB/s in 4 frames/s; 3 xterm writes/s, 5 ms each')
    expect(report).toContain('output frames received since the window opened: 40, of which over the local socket: 38')
    expect(report).toContain('key replies from the host (last 40 keys): median 3 ms, worst 410 ms')
    expect(report).toContain('sent to the window since it started: 41')
    expect(report).toContain('  11  13% cpu  2 MiB  WebKitWebProcess')
    expect(report).toContain('  12  1% cpu  1 KiB  /usr/bin/daemon daemon')
  })
})
