import { Suspense, lazy } from 'react';
import clsx from 'clsx';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { useConfigWindow } from '../hooks/useConfigWindow';
import styles from './__root.module.css';

const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/router-devtools').then((res) => ({
        default: res.TanStackRouterDevtools,
      })),
    )
  : () => null;

export const Route = createRootRoute({
  component: RootLayout,
});

/**
 * Expert mode appears as a tab only while the device's configuration window is
 * open (#144), and vanishes when it lapses.
 *
 * The presence of the tab is the whole explanation. A permanent tab would put
 * these settings in front of every operator all the time - an invitation to the
 * one accident the window exists to prevent - and a tab that was always there
 * but refused to save would have to explain itself in an error message nobody
 * reads. Here there is nothing to explain: press the button at the device and
 * the tab is there.
 *
 * The label is the label and nothing else - a countdown in a tab name would put
 * a changing number in the navigation and pull this tab's text out of line with
 * its neighbours. It belongs on the page it applies to.
 */
function RootLayout(): React.ReactNode {
  const { open: expertOpen } = useConfigWindow();

  return (
    <div className={styles.layout}>
      <nav className={styles.nav}>
        <Link to='/run' className={styles.link} activeProps={{ className: styles.active }}>
          Run
        </Link>
        <Link to='/programs' className={styles.link} activeProps={{ className: styles.active }}>
          Programs
        </Link>
        <Link to='/audios' className={styles.link} activeProps={{ className: styles.active }}>
          Audios
        </Link>
        <Link to='/settings' className={styles.link} activeProps={{ className: styles.active }}>
          Settings
        </Link>
        {expertOpen && (
          <Link
            to='/hardware'
            className={clsx(styles.link, styles.expertLink)}
            activeProps={{ className: styles.active }}
            data-testid='expert-tab'
          >
            Expert mode
          </Link>
        )}
      </nav>
      <main className={styles.content}>
        <Outlet />
      </main>
      <Suspense fallback={null}>
        <TanStackRouterDevtools />
      </Suspense>
    </div>
  );
}
