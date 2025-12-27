import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import styles from './__root.module.css';

export const Route = createRootRoute({
  component: () => (
    <div className={styles.layout}>
      <nav className={styles.nav}>
        <Link to='/run' className={styles.link} activeProps={{ className: styles.active }}>
          Run
        </Link>
        <Link to='/legacy' className={styles.link} activeProps={{ className: styles.active }}>
          Legacy App
        </Link>
      </nav>
      <main className={styles.content}>
        <Outlet />
      </main>
      <TanStackRouterDevtools />
    </div>
  ),
});
