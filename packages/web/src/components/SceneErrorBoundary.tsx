import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class SceneErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cfe8ff',
            fontFamily: 'ui-monospace, monospace',
            gap: 12,
          }}
        >
          <strong>net3d hit a rendering error</strong>
          <code style={{ color: '#e05656', maxWidth: 600 }}>{this.state.error.message}</code>
          <button
            onClick={() => location.reload()}
            style={{
              background: '#13283d',
              color: '#cfe8ff',
              border: '1px solid #2a4a6a',
              borderRadius: 6,
              padding: '8px 16px',
              cursor: 'pointer',
            }}
          >
            reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
