import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'

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
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
)
