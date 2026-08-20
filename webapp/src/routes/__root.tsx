import { Suspense, lazy } from 'react';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import styles from './__root.module.css';

const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/router-devtools').then((res) => ({
        default: res.TanStackRouterDevtools,
      })),
    )
  : () => null;

export const Route = createRootRoute({
  component: () => (
    <div className={styles.layout}>
      <nav className={styles.nav}>
        <Link to='/run' className={styles.link} activeProps={{ className: styles.active }}>
          Run
        </Link>
        <Link to='/settings' className={styles.link} activeProps={{ className: styles.active }}>
          Settings
        </Link>
        <Link to='/legacy' className={styles.link} activeProps={{ className: styles.active }}>
          Legacy App
        </Link>
      </nav>
      <main className={styles.content}>
        <Outlet />
      </main>
      <Suspense fallback={null}>
        <TanStackRouterDevtools />
      </Suspense>
    </div>
  ),
});
