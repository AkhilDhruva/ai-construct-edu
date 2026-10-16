import { Component, type ReactNode } from 'react'

/** A failing page degrades to a message; the shell, navigation and saved progress stay intact. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="callout callout-danger" role="alert">
        <strong>This page hit an error.</strong> Your progress is saved. Try another page or reload.
        <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>
          {this.state.error.message}
        </pre>
      </div>
    )
  }
}
