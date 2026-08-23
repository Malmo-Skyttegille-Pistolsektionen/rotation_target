import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { SettingsProvider } from './context/SettingsContext';
import { StandaloneEditorApp } from './standalone/StandaloneEditorApp';
import './index.css';

/**
 * The GitHub Pages entry (#140): the same `ProgramEditor` the device build
 * uses, in its "no device" mode. Separate from `main.tsx` and built by
 * `vite.editor.config.ts` into its own output — never staged into the
 * firmware image, so this page's code cannot grow the on-device bundle.
 *
 * `ProgramEditor` calls `useBlocker()` unconditionally (it works the same way
 * on both builds), which needs a router in context. This page does no actual
 * routing — one screen, no navigation — so the router carries a single root
 * route on in-memory history rather than the browser's, which sidesteps
 * GitHub Pages' subpath (`/rotation_target/editor/`) entirely.
 */
const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: StandaloneEditorApp });
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <RouterProvider router={router} />
      </SettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
