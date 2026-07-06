import { createRoot } from 'react-dom/client'
import { Component, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'

class TopLevelErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      const e = this.state.error as Error
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', background: '#fff' }}>
          <h2 style={{ color: '#dc2626' }}>net3d crashed: {e.message}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#374151', fontSize: 12 }}>
            {e.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

// NOTE: React.StrictMode is intentionally omitted. Its double mount/unmount in
// dev leaves @react-three/fiber v9's pointer-event system disconnected
// (events.connected === false), silently breaking all hover/click on the 3D
// scene (device select, highlight, tooltip). See RackLevel device interaction.
createRoot(document.getElementById('root')!).render(
  <TopLevelErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </TopLevelErrorBoundary>,
)
