import { Component } from 'react'
import type { ReactNode } from 'react'
import './RecordManagement.css'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return <main className="record-page">
      <section className="record-form" aria-labelledby="error-title">
        <h1 id="error-title">Something went wrong</h1>
        <div><button type="button" className="record-button" onClick={() => window.location.reload()}>Reload page</button></div>
      </section>
    </main>
  }
}
