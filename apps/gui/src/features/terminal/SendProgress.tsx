const FULL = 100

/** How far a file being sent to another machine has got; a bar with no fill until its size is known. */
export function SendProgress({ file, percent, verb = 'Sending' }: { file: string; percent: number | null; verb?: string }) {
  const shown = percent === null ? 0 : Math.min(FULL, Math.max(0, percent))
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label={`${verb} ${file}`}
        aria-valuemin={0}
        aria-valuemax={FULL}
        aria-valuenow={percent === null ? undefined : shown}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${String(shown)}%` }} />
      </div>
      {/* Its line is kept while no share is known: the toaster hangs from the window's foot, so a line that came and
          went with each file would lift the toast and its spinner and drop them again. */}
      <span className="h-4 w-9 text-right text-xs tabular-nums text-muted-foreground">{percent === null ? '' : `${String(shown)}%`}</span>
    </div>
  )
}
