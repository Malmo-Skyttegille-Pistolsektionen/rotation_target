import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { useSSE } from './hooks/useSSE';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { updateBaseUrl } from './api/client';
import './index.css';

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // Data is fresh for 1 minute by default
    },
  },
});

function App() {
  const { settings } = useSettings();

  // Push the configured server URL into the API client at startup, and again
  // whenever it changes.
  //
  // It was previously only done from the settings *route*, so a URL saved to
  // localStorage did not take effect until the user happened to open that page
  // - every REST call before then went to the default instead. Doing it here
  // means the stored value applies from the first render.
  //
  // Runs before useSSE so the stream picks up the same URL on this render.
  useEffect(() => {
    updateBaseUrl(settings.serverBaseUrl);
  }, [settings.serverBaseUrl]);

  // Initialize SSE connection globally
  useSSE();
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
