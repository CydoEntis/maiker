import { Component, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** What failed, for the person: "This chat". */
  what: string
  /** A way out that does not need the part that failed (the terminal under a chat), or null. */
  fallback?: { label: string; run: () => void } | null
}

type State = { failed: Error | null }

/**
 * Keeps a fault in one pane inside that pane. Without it a render error anywhere replaced the whole window with
 * "Reload app", and every other session went with it. The session itself lives in the daemon, so trying again only
 * draws the pane again.
 */
export class PaneErrorBoundary extends Component<Props, State> {
  override state: State = { failed: null }

  static getDerivedStateFromError(error: unknown): State {
    return { failed: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: unknown): void {
    console.error(`${this.props.what} could not be drawn`, error)
  }

  override render() {
    const { failed } = this.state
    if (failed === null) return this.props.children
    const { what, fallback = null } = this.props
    return (
      <div className="mx-pane-fault" role="alert">
        <p className="mx-pane-fault-title">{what} hit a problem</p>
        <p className="mx-pane-fault-detail">The session keeps running. {failed.message}</p>
        <div className="mx-pane-fault-actions">
          <button type="button" className="mx-primary" onClick={() => { this.setState({ failed: null }) }}>Try again</button>
          {fallback !== null && <button type="button" className="mx-quiet" onClick={fallback.run}>{fallback.label}</button>}
        </div>
      </div>
    )
  }
}
