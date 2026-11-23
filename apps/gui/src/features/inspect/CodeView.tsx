import { isTauri } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { HighlightedLine } from '@/components/HighlightedLine'
import { type HighlightedLines, highlightFile } from './api'

type Colored = { path: string; text: string; lines: HighlightedLines }

/**
 * The file's lines as the shared highlighter colours them (the same grammars as the terminal app), or null until it
 * answers and where it has no grammar: the built-in per-line colouring stands in then, so a file is never drawn late.
 */
function useHighlighted(path: string, text: string): HighlightedLines {
  const [colored, setColored] = useState<Colored | null>(null)
  useEffect(() => {
    if (!isTauri()) return undefined
    let current = true
    // Best effort: a failed answer leaves the built-in colouring in place, which is a complete drawing of the file.
    highlightFile(path, text).then((lines) => { if (current) setColored({ path, text, lines }) }, () => undefined)
    return () => { current = false }
  }, [path, text])
  return colored !== null && colored.path === path && colored.text === text ? colored.lines : null
}

function Spans({ spans }: { spans: NonNullable<HighlightedLines>[number] }) {
  return <>{spans.map((span, index) => (span.kind === 'plain' ? span.text : <span key={index} className={`tok-${span.kind}`}>{span.text}</span>))}</>
}

/** A text file, read-only: every line numbered and coloured by the theme's syntax roles. `target` is a line a link asked for. */
export function CodeView({ path, text, target }: { path: string; text: string; target?: number | undefined }) {
  const colored = useHighlighted(path, text)
  useEffect(() => {
    if (target === undefined) return
    document.querySelector(`[data-file-line="${String(target)}"]`)?.scrollIntoView({ block: 'center' })
  }, [target, text])
  return (
    <pre className="mx-src" tabIndex={0} aria-label={`Text of ${path}`}>
      {text.split('\n').map((line, index) => (
        <span key={index} className={`mx-src-line${target === index + 1 ? ' is-target' : ''}`} data-file-line={index + 1}>
          {/* Drawn by the stylesheet, so copying the file copies only its text. */}
          <i className="mx-src-no" data-no={index + 1} aria-hidden="true" />
          <span className="mx-src-text">{colored?.[index] ? <Spans spans={colored[index]} /> : <HighlightedLine line={line} path={path} />}</span>
          {'\n'}
        </span>
      ))}
    </pre>
  )
}
